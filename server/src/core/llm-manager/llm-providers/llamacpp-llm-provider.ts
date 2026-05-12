import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable } from 'node:stream'

import axios, { type AxiosResponse } from 'axios'
import kill from 'tree-kill'

import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import {
  CODEBASE_PATH,
  LLAMACPP_BUILD_PATH,
  LLAMACPP_BUILD_MANIFEST_PATH,
  LLAMACPP_PATH,
  LLAMACPP_ROOT_MANIFEST_PATH,
  LLAMACPP_SOURCE_BUILD_PATH,
  LLAMACPP_SOURCE_MANIFEST_PATH,
  LLAMACPP_SOURCE_PATH,
  PROFILE_LOGS_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

const DEFAULT_LLAMACPP_BASE_URL =
  process.env['LEON_LLAMACPP_BASE_URL'] || 'http://127.0.0.1:8080/v1'
const LLAMACPP_READY_TIMEOUT_MS = 120_000
const LLAMACPP_READY_POLL_INTERVAL_MS = 250
const LLAMA_SERVER_LOG_RESET_INTERVAL_MS = 12 * 60 * 60 * 1_000
const LLAMACPP_MAX_PORT_CHECKS = 10
const LLAMA_SERVER_LOG_PATH = path.join(
  PROFILE_LOGS_PATH,
  'llama-server.log'
)

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function getURLPort(url: URL): number {
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80))
}

function toBaseURL(baseURL: string): string {
  const url = new URL(baseURL)
  return url.toString().endsWith('/') ? url.toString().slice(0, -1) : url.toString()
}

function toModelsURL(baseURL: string): string {
  const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`

  return new URL('models', normalizedBaseURL).toString()
}

function toChatCompletionsURL(baseURL: string): string {
  const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`

  return new URL('chat/completions', normalizedBaseURL).toString()
}

function withPort(baseURL: string, port: number): string {
  const url = new URL(baseURL)
  url.port = String(port)

  return toBaseURL(url.toString())
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', (error: NodeJS.ErrnoException) => {
      server.close()

      if (error.code === 'EADDRINUSE') {
        resolve(false)
        return
      }

      reject(error)
    })

    server.once('listening', () => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(true)
      })
    })

    server.listen(port, host)
  })
}

function readLlamaCPPManifest(): Record<string, unknown> | null {
  const manifestEntries = [
    {
      manifestPath: LLAMACPP_SOURCE_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_SOURCE_PATH
    },
    {
      manifestPath: LLAMACPP_BUILD_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_BUILD_PATH
    },
    {
      manifestPath: LLAMACPP_ROOT_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_PATH
    }
  ]

  for (const manifestEntry of manifestEntries) {
    if (!fs.existsSync(manifestEntry.manifestPath)) {
      continue
    }

    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestEntry.manifestPath, 'utf8')
      )

      return {
        ...manifest,
        runtimeDirectoryPath:
          typeof manifest.runtimePath === 'string' && manifest.runtimePath
            ? path.join(manifestEntry.runtimeBasePath, manifest.runtimePath)
            : null
      }
    } catch {
      return null
    }
  }

  return null
}

function getLlamaServerBinaryDirectoryPath(): string {
  const binaryName = SystemHelper.isWindows() ? 'llama-server.exe' : 'llama-server'
  const manifest = readLlamaCPPManifest()

  if (
    typeof manifest?.['runtimeDirectoryPath'] === 'string' &&
    manifest['runtimeDirectoryPath']
  ) {
    return manifest['runtimeDirectoryPath']
  }

  if (fs.existsSync(path.join(LLAMACPP_SOURCE_BUILD_PATH, binaryName))) {
    return LLAMACPP_SOURCE_BUILD_PATH
  }

  return LLAMACPP_BUILD_PATH
}

function getLlamaServerBinaryPath(): string {
  return path.join(
    getLlamaServerBinaryDirectoryPath(),
    SystemHelper.isWindows() ? 'llama-server.exe' : 'llama-server'
  )
}

function resolveModelPath(modelPath: string): string {
  const normalizedModelPath = modelPath.trim()

  return path.isAbsolute(normalizedModelPath)
    ? normalizedModelPath
    : path.resolve(CODEBASE_PATH, normalizedModelPath)
}

/**
 * Share one llama-server process across workflow and agent providers.
 */
export default class LlamaCPPLLMProvider extends AISDKRemoteLLMProvider {
  private static serverProcess: ChildProcessWithoutNullStreams | null = null
  private static serverLogStream: fs.WriteStream | null = null
  private static nextServerLogResetAt = 0
  private static activeModelPath: string | null = null
  private static runtimeBaseURL = DEFAULT_LLAMACPP_BASE_URL
  private static serverReady = false
  private static isUsingExternalServer = false
  private static serverReadyPromise: Promise<void> | null = null
  private static instanceCount = 0

  private readonly modelPath: string

  constructor(target: ResolvedLLMTarget) {
    super(
      {
        name: 'llama.cpp LLM Provider',
        providerName: 'llamacpp',
        apiKeyEnv: 'LEON_LLAMACPP_API_KEY',
        model: target.model,
        baseURL: LlamaCPPLLMProvider.runtimeBaseURL,
        flavor: 'openai-compatible',
        requiresApiKey: false
      }
    )

    if (!this.model.trim()) {
      throw new Error(
        'llama.cpp model path is not defined. Please configure LEON_LLM or install a default local LLM.'
      )
    }

    this.modelPath = resolveModelPath(this.model)
    LlamaCPPLLMProvider.instanceCount += 1
  }

  public override get modelName(): string {
    return this.modelPath
  }

  public async boot(): Promise<void> {
    await this.ensureServerReady()
  }

  public isServerReady(): boolean {
    return (
      LlamaCPPLLMProvider.serverReady || LlamaCPPLLMProvider.isUsingExternalServer
    )
  }

  public override dispose(): void {
    super.dispose()

    LlamaCPPLLMProvider.instanceCount = Math.max(
      0,
      LlamaCPPLLMProvider.instanceCount - 1
    )

    if (LlamaCPPLLMProvider.instanceCount === 0) {
      void LlamaCPPLLMProvider.disposeSharedServer()
    }
  }

  public override async runChatCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<AxiosResponse> {
    await this.ensureServerReady()

    const isPlainTextRequest =
      !Array.isArray(completionParams.tools) && completionParams.data === null

    if (completionParams.shouldStream === true && isPlainTextRequest) {
      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.info(
        'Using direct llama.cpp streaming chat completion for plain-text request.'
      )

      return this.runDirectPlainTextStreamingCompletion(prompt, completionParams)
    }

    if (completionParams.shouldStream !== true && isPlainTextRequest) {
      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.info(
        'Using direct non-stream llama.cpp chat completion for plain-text request.'
      )

      return this.runDirectPlainTextCompletion(prompt, completionParams)
    }

    return super.runChatCompletion(prompt, completionParams)
  }

  private async runDirectPlainTextCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<AxiosResponse> {
    const response = await axios.post(
      LlamaCPPLLMProvider.getChatCompletionsURL(),
      this.buildDirectPlainTextPayload(prompt, completionParams, false),
      this.buildDirectRequestConfig(completionParams)
    )

    return response as AxiosResponse
  }

  private async runDirectPlainTextStreamingCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<AxiosResponse> {
    const response = await axios.post(
      LlamaCPPLLMProvider.getChatCompletionsURL(),
      this.buildDirectPlainTextPayload(prompt, completionParams, true),
      {
        ...this.buildDirectRequestConfig(completionParams),
        responseType: 'stream'
      }
    )

    const stream = response.data as Readable
    const aggregated = await this.consumeStreamingResponse(
      stream,
      completionParams
    )

    return {
      ...response,
      data: aggregated
    } as AxiosResponse
  }

  private buildDirectPlainTextPayload(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams,
    shouldStream: boolean
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: this.modelPath,
      messages: this.toDirectChatMessages(prompt, completionParams),
      stream: shouldStream,
      temperature:
        typeof completionParams.temperature === 'number'
          ? completionParams.temperature
          : 0,
      max_tokens:
        typeof completionParams.maxTokens === 'number'
          ? completionParams.maxTokens
          : 256
    }

    if (completionParams.disableThinking === true) {
      payload['chat_template_kwargs'] = {
        enable_thinking: false
      }
      payload['reasoning_format'] = 'none'
    }

    return payload
  }

  private buildDirectRequestConfig(
    completionParams: CompletionParams
  ): Record<string, unknown> {
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env['LEON_LLAMACPP_API_KEY'] || 'Bearer no-key'}`
      },
      ...(typeof completionParams.timeout === 'number'
        ? { timeout: completionParams.timeout }
        : {}),
      ...(completionParams.signal ? { signal: completionParams.signal } : {})
    }
  }

  private async consumeStreamingResponse(
    stream: Readable,
    completionParams: CompletionParams
  ): Promise<Record<string, unknown>> {
    let text = ''
    let reasoning = ''
    let promptTokens = 0
    let completionTokens = 0
    let predictedPerSecond = 0
    let predictedMs = 0
    let buffer = ''
    let firstStreamBlockAt: number | null = null
    let lastStreamBlockAt: number | null = null

    const applyChunk = (chunk: Record<string, unknown>): void => {
      const usage =
        chunk['usage'] && typeof chunk['usage'] === 'object'
          ? (chunk['usage'] as Record<string, unknown>)
          : null
      if (usage) {
        if (typeof usage['prompt_tokens'] === 'number') {
          promptTokens = usage['prompt_tokens'] as number
        }
        if (typeof usage['completion_tokens'] === 'number') {
          completionTokens = usage['completion_tokens'] as number
        }
      }

      const timings =
        chunk['timings'] && typeof chunk['timings'] === 'object'
          ? (chunk['timings'] as Record<string, unknown>)
          : null

      if (timings) {
        if (typeof timings['prompt_n'] === 'number') {
          promptTokens = timings['prompt_n'] as number
        }
        if (typeof timings['predicted_n'] === 'number') {
          completionTokens = timings['predicted_n'] as number
        }
        if (typeof timings['predicted_per_second'] === 'number') {
          predictedPerSecond = timings['predicted_per_second'] as number
        }
        if (typeof timings['predicted_ms'] === 'number') {
          predictedMs = timings['predicted_ms'] as number
        }
      }

      const choices = Array.isArray(chunk['choices'])
        ? (chunk['choices'] as Array<Record<string, unknown>>)
        : []
      const firstChoice = choices[0]
      if (!firstChoice || typeof firstChoice !== 'object') {
        return
      }

      const delta =
        firstChoice['delta'] && typeof firstChoice['delta'] === 'object'
          ? (firstChoice['delta'] as Record<string, unknown>)
          : null
      if (!delta) {
        return
      }

      const content = delta['content']
      if (typeof content === 'string' && content.length > 0) {
        const now = Date.now()
        if (firstStreamBlockAt === null) {
          firstStreamBlockAt = now
        }
        lastStreamBlockAt = now
        text += content
        completionParams.onToken?.(content)
      }

      const reasoningChunk = this.readReasoningChunk(delta)
      if (reasoningChunk) {
        const now = Date.now()
        if (firstStreamBlockAt === null) {
          firstStreamBlockAt = now
        }
        lastStreamBlockAt = now
        reasoning += reasoningChunk
        completionParams.onReasoningToken?.(reasoningChunk)
      }
    }

    const parseEvent = (rawEvent: string): void => {
      const lines = rawEvent.split('\n')
      const dataLines: string[] = []

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) {
          continue
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }

      if (dataLines.length === 0) {
        return
      }

      const data = dataLines.join('\n')
      if (data === '[DONE]') {
        return
      }

      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        applyChunk(parsed as Record<string, unknown>)
      }
    }

    return new Promise((resolve, reject) => {
      stream.setEncoding('utf8')

      stream.on('data', (chunk: string) => {
        buffer += chunk.replace(/\r\n/g, '\n')

        while (true) {
          const separatorIndex = buffer.indexOf('\n\n')
          if (separatorIndex === -1) {
            break
          }

          const rawEvent = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)

          try {
            parseEvent(rawEvent)
          } catch (error) {
            reject(error)
            return
          }
        }
      })

      stream.on('end', () => {
        const remainingEvent = buffer.trim()
        if (remainingEvent) {
          try {
            parseEvent(remainingEvent)
          } catch (error) {
            reject(error)
            return
          }
        }

        resolve({
          choices: [
            {
              message: {
                content: text,
                ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {})
              }
            }
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens
          },
          ...((predictedMs > 0 || predictedPerSecond > 0 ||
            (firstStreamBlockAt !== null && lastStreamBlockAt !== null))
            ? {
                timings: {
                  predicted_ms:
                    predictedMs > 0
                      ? predictedMs
                      : Math.max(lastStreamBlockAt! - firstStreamBlockAt!, 0),
                  ...(predictedPerSecond > 0
                    ? { predicted_per_second: predictedPerSecond }
                    : {})
                }
              }
            : {})
        })

      })

      stream.on('error', (error) => {
        reject(error)
      })
    })
  }

  private readReasoningChunk(delta: Record<string, unknown>): string {
    const directReasoningFields = [
      delta['reasoning'],
      delta['reasoning_content'],
      delta['reasoningContent']
    ]

    for (const field of directReasoningFields) {
      if (typeof field === 'string' && field.length > 0) {
        return field
      }
    }

    const content = Array.isArray(delta['content'])
      ? (delta['content'] as Array<Record<string, unknown>>)
      : null
    if (!content) {
      return ''
    }

    let reasoning = ''
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const type = typeof item['type'] === 'string' ? item['type'] : ''
      if (type !== 'reasoning' && type !== 'thinking') {
        continue
      }

      const text =
        typeof item['text'] === 'string'
          ? item['text']
          : typeof item['content'] === 'string'
            ? item['content']
            : ''

      if (text) {
        reasoning += text
      }
    }

    return reasoning
  }

  private toDirectChatMessages(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Array<Record<string, string>> {
    const messages: Array<Record<string, string>> = []
    const systemPrompt = String(completionParams.systemPrompt ?? '').trim()

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      })
    }

    if (completionParams.history) {
      for (const message of completionParams.history) {
        messages.push({
          role: message.who === 'leon' ? 'assistant' : 'user',
          content: message.message
        })
      }
    }

    const promptText =
      typeof prompt === 'string' ? prompt : JSON.stringify(prompt)

    if (promptText.trim()) {
      messages.push({
        role: 'user',
        content: promptText
      })
    }

    return messages
  }

  private async ensureServerReady(): Promise<void> {
    this.setBaseURL(LlamaCPPLLMProvider.runtimeBaseURL)

    if (LlamaCPPLLMProvider.serverReady) {
      if (LlamaCPPLLMProvider.isUsingExternalServer) {
        const existingServerProbe =
          await LlamaCPPLLMProvider.probeServerReady(
            LlamaCPPLLMProvider.runtimeBaseURL
          )

        if (existingServerProbe.ready) {
          return
        }

        LlamaCPPLLMProvider.serverReady = false
        LlamaCPPLLMProvider.isUsingExternalServer = false
      }

      if (
        LlamaCPPLLMProvider.serverProcess &&
        !LlamaCPPLLMProvider.serverProcess.killed &&
        LlamaCPPLLMProvider.activeModelPath === this.modelPath
      ) {
        return
      }
    }

    if (
      LlamaCPPLLMProvider.serverProcess &&
      LlamaCPPLLMProvider.activeModelPath !== this.modelPath
    ) {
      await LlamaCPPLLMProvider.disposeSharedServer()
    }

    if (LlamaCPPLLMProvider.serverReadyPromise) {
      await LlamaCPPLLMProvider.serverReadyPromise
      this.setBaseURL(LlamaCPPLLMProvider.runtimeBaseURL)
      return
    }

    const startupPromise = LlamaCPPLLMProvider.startSharedServer(this.modelPath)
    LlamaCPPLLMProvider.serverReadyPromise = startupPromise

    try {
      await startupPromise
      this.setBaseURL(LlamaCPPLLMProvider.runtimeBaseURL)
    } finally {
      if (LlamaCPPLLMProvider.serverReadyPromise === startupPromise) {
        LlamaCPPLLMProvider.serverReadyPromise = null
      }
    }
  }

  private static async startSharedServer(modelPath: string): Promise<void> {
    const existingServerProbe = await this.probeServerReady(
      DEFAULT_LLAMACPP_BASE_URL
    )

    if (existingServerProbe.ready) {
      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.info(
        `Reusing existing llama-server at "${toModelsURL(DEFAULT_LLAMACPP_BASE_URL)}"`
      )
      this.writeServerLogLine(
        `Reusing existing llama-server at "${toModelsURL(DEFAULT_LLAMACPP_BASE_URL)}".`
      )

      this.serverProcess = null
      this.activeModelPath = null
      this.runtimeBaseURL = DEFAULT_LLAMACPP_BASE_URL
      this.serverReady = true
      this.isUsingExternalServer = true

      return
    }

    const binaryPath = getLlamaServerBinaryPath()

    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `Cannot find llama.cpp server binary at "${binaryPath}".`
      )
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(
        `Cannot find llama.cpp model at "${modelPath}".`
      )
    }

    LogHelper.title('llama.cpp LLM Provider')
    LogHelper.info(`Starting llama-server with model "${modelPath}"...`)

    this.writeServerLogLine(
      `Starting llama-server with model "${modelPath}".`
    )
    const runtimeBaseURL = await this.resolveRuntimeBaseURL()
    const runtimeServerURL = new URL(runtimeBaseURL)

    const serverProcess = spawn(
      binaryPath,
      [
        '--model',
        modelPath,
        '--host',
        runtimeServerURL.hostname,
        '--port',
        String(getURLPort(runtimeServerURL)),
        '--ctx-size',
        '16384',
        '--flash-attn',
        'on',
        '--cache-type-k',
        'q8_0',
        '--cache-type-v',
        'q8_0',
        '--parallel',
        '1'
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true
      }
    )

    this.serverProcess = serverProcess
    this.activeModelPath = modelPath
    this.runtimeBaseURL = runtimeBaseURL
    this.serverReady = false
    this.isUsingExternalServer = false

    serverProcess.on('exit', (code, signal) => {
      if (this.serverProcess !== serverProcess) {
        return
      }

      this.serverProcess = null
      this.activeModelPath = null
      this.serverReady = false
      this.isUsingExternalServer = false
      this.serverReadyPromise = null

      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.warning(
        `llama-server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`
      )

      this.writeServerLogLine(
        `llama-server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}.`
      )
      this.closeServerLogStream()
    })

    serverProcess.stdout.on('data', (data: Buffer) => {
      this.writeServerLogChunk(data)
    })

    serverProcess.stderr.on('data', (data: Buffer) => {
      this.writeServerLogChunk(data)
    })

    try {
      await this.waitForServerReady(serverProcess)
      this.serverReady = true

      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.success('llama-server is ready')
      this.writeServerLogLine('llama-server is ready.')
    } catch (error) {
      await this.disposeSharedServer()
      throw error
    }
  }

  private static async waitForServerReady(
    serverProcess: ChildProcessWithoutNullStreams
  ): Promise<void> {
    let spawnError: Error | null = null
    let lastHealthErrorMessage = ''

    serverProcess.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error))
    })

    const deadline = Date.now() + LLAMACPP_READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (spawnError) {
        throw spawnError
      }

      if (serverProcess.exitCode !== null) {
        throw new Error(
          `llama-server exited before it became ready (code=${serverProcess.exitCode}).`
        )
      }

      if (serverProcess.signalCode !== null) {
        throw new Error(
          `llama-server exited before it became ready (signal=${serverProcess.signalCode}).`
        )
      }

      const readinessProbe = await this.probeServerReady(this.runtimeBaseURL)
      if (readinessProbe.ready) {
        return
      }

      lastHealthErrorMessage = readinessProbe.errorMessage

      await wait(LLAMACPP_READY_POLL_INTERVAL_MS)
    }

    const lastErrorSuffix = lastHealthErrorMessage
      ? ` Last probe error: ${lastHealthErrorMessage}`
      : ''

    throw new Error(
      `Timed out while waiting for llama-server to become ready.${lastErrorSuffix}`
    )
  }

  private static async probeServerReady(baseURL: string): Promise<{
    ready: boolean
    errorMessage: string
  }> {
    try {
      await axios.get(toModelsURL(baseURL), {
        timeout: 1_000
      })

      return {
        ready: true,
        errorMessage: ''
      }
    } catch (error) {
      return {
        ready: false,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private static async disposeSharedServer(): Promise<void> {
    const serverProcess = this.serverProcess

    this.serverProcess = null
    this.activeModelPath = null
    this.runtimeBaseURL = DEFAULT_LLAMACPP_BASE_URL
    this.serverReady = false
    this.isUsingExternalServer = false
    this.serverReadyPromise = null

    if (!serverProcess?.pid) {
      this.closeServerLogStream()
      return
    }

    await new Promise<void>((resolve) => {
      kill(serverProcess.pid as number, 'SIGTERM', () => {
        resolve()
      })
    })

    this.writeServerLogLine('Stopped llama-server.')
    this.closeServerLogStream()

    LogHelper.title('llama.cpp LLM Provider')
    LogHelper.info('Stopped llama-server')
  }

  private static getChatCompletionsURL(): string {
    return toChatCompletionsURL(this.runtimeBaseURL)
  }

  private static async resolveRuntimeBaseURL(): Promise<string> {
    const configuredServerURL = new URL(DEFAULT_LLAMACPP_BASE_URL)
    const configuredHost = configuredServerURL.hostname
    const configuredPort = getURLPort(configuredServerURL)

    for (let portOffset = 0; portOffset < LLAMACPP_MAX_PORT_CHECKS; portOffset += 1) {
      const port = configuredPort + portOffset
      const isAvailable = await isPortAvailable(configuredHost, port)

      if (!isAvailable) {
        continue
      }

      const runtimeBaseURL =
        portOffset === 0
          ? toBaseURL(DEFAULT_LLAMACPP_BASE_URL)
          : withPort(DEFAULT_LLAMACPP_BASE_URL, port)

      if (portOffset > 0) {
        const warningMessage =
          `Port ${configuredPort} is unavailable for llama-server. ` +
          `Using port ${port} instead via "${runtimeBaseURL}".`

        LogHelper.title('llama.cpp LLM Provider')
        LogHelper.warning(warningMessage)
        this.writeServerLogLine(warningMessage)
      }

      return runtimeBaseURL
    }

    throw new Error(
      `Unable to find an available port for llama-server starting from ${configuredPort} on host "${configuredHost}".`
    )
  }

  private static writeServerLogChunk(chunk: Buffer): void {
    const stream = this.ensureServerLogStream()

    stream.write(chunk)
  }

  private static writeServerLogLine(message: string): void {
    const stream = this.ensureServerLogStream()

    stream.write(`[${new Date().toISOString()}] ${message}\n`)
  }

  private static ensureServerLogStream(): fs.WriteStream {
    const now = Date.now()

    if (!this.serverLogStream) {
      const { flags, nextResetAt } = this.getServerLogOpenState(now)

      fs.mkdirSync(PROFILE_LOGS_PATH, { recursive: true })
      this.serverLogStream = fs.createWriteStream(LLAMA_SERVER_LOG_PATH, {
        flags
      })
      this.nextServerLogResetAt = nextResetAt

      return this.serverLogStream
    }

    if (now >= this.nextServerLogResetAt) {
      this.serverLogStream.end()
      this.serverLogStream = fs.createWriteStream(LLAMA_SERVER_LOG_PATH, {
        flags: 'w'
      })
      this.nextServerLogResetAt = now + LLAMA_SERVER_LOG_RESET_INTERVAL_MS
    }

    return this.serverLogStream
  }

  private static getServerLogOpenState(now: number): {
    flags: 'a' | 'w'
    nextResetAt: number
  } {
    if (!fs.existsSync(LLAMA_SERVER_LOG_PATH)) {
      return {
        flags: 'w',
        nextResetAt: now + LLAMA_SERVER_LOG_RESET_INTERVAL_MS
      }
    }

    const { mtimeMs } = fs.statSync(LLAMA_SERVER_LOG_PATH)

    if (now - mtimeMs >= LLAMA_SERVER_LOG_RESET_INTERVAL_MS) {
      return {
        flags: 'w',
        nextResetAt: now + LLAMA_SERVER_LOG_RESET_INTERVAL_MS
      }
    }

    return {
      flags: 'a',
      nextResetAt: mtimeMs + LLAMA_SERVER_LOG_RESET_INTERVAL_MS
    }
  }

  private static closeServerLogStream(): void {
    this.serverLogStream?.end()
    this.serverLogStream = null
    this.nextServerLogResetAt = 0
  }
}
