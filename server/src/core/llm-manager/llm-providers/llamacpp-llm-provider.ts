import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable } from 'node:stream'

import axios, { type AxiosResponse } from 'axios'
import kill from 'tree-kill'

import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import { CONFIG_MANAGER } from '@/config'
import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { InferencePurpose } from '@/core/llm-manager/types'
import { CODEBASE_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { getLlamaCPPServerBinaryPath, getLlamaCPPModelArguments, resolveLlamaCPPContextPlan } from './llamacpp-context'
import { readCompletionAccounting, type CompletionAccounting } from '@/core/llm-manager/llm-usage/usage-accounting'
import { recordInferenceUsage, getActiveInferencePurpose } from '@/core/llm-manager/llm-usage/usage-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { LocalInferenceScheduler, LocalInferencePriority } from '@/core/llm-manager/local-inference-scheduler'
import { getTurnTimingContext, runTurnPhase, TurnPhase, TurnStage } from '@/core/llm-manager/turn-timing'

const DEFAULT_LLAMACPP_BASE_URL = 'http://127.0.0.1:8080/v1'
const LLAMACPP_READY_TIMEOUT_MS = 120_000
const LLAMACPP_READY_POLL_INTERVAL_MS = 250
const LLAMA_SERVER_LOG_RESET_INTERVAL_MS = 12 * 60 * 60 * 1_000
const LLAMACPP_MAX_PORT_CHECKS = 10
const LLAMACPP_METADATA_TIMEOUT_MS = 5_000
const LLAMA_SERVER_LOG_FILENAME = 'llama-server.log'
const LLAMACPP_DISABLE_THINKING_CHAT_TEMPLATE_KWARGS = {
  enable_thinking: false
}
const LLAMACPP_ENABLE_THINKING_CHAT_TEMPLATE_KWARGS = {
  enable_thinking: true
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function getLlamaServerLogPath(): string {
  return path.join(getProfilePaths().logs, LLAMA_SERVER_LOG_FILENAME)
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

function resolveModelPath(modelPath: string): string {
  const normalizedModelPath = modelPath.trim()

  return path.isAbsolute(normalizedModelPath)
    ? normalizedModelPath
    : path.resolve(CODEBASE_PATH, normalizedModelPath)
}

function configureStructuredRequestThinking(
  args: Record<string, unknown>
): Record<string, unknown> {
  const hasTools = Array.isArray(args['tools'])
  const hasResponseFormat = Boolean(args['response_format'])

  if (!hasTools && !hasResponseFormat) {
    return args
  }

  const existingChatTemplateKwargs =
    args['chat_template_kwargs'] &&
    typeof args['chat_template_kwargs'] === 'object' &&
    !Array.isArray(args['chat_template_kwargs'])
      ? (args['chat_template_kwargs'] as Record<string, unknown>)
      : {}

  return {
    ...args,
    chat_template_kwargs: {
      ...(args['stream'] === true
        ? LLAMACPP_ENABLE_THINKING_CHAT_TEMPLATE_KWARGS
        : LLAMACPP_DISABLE_THINKING_CHAT_TEMPLATE_KWARGS),
      ...existingChatTemplateKwargs
    }
  }
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
  private static configuredBaseURL = DEFAULT_LLAMACPP_BASE_URL
  private static serverReady = false
  private static isUsingExternalServer = false
  private static serverReadyPromise: Promise<void> | null = null
  private static instanceCount = 0
  private static contextWindowTokens: number | undefined
  private static readonly inferenceScheduler = new LocalInferenceScheduler()

  private readonly modelPath: string
  private readonly configuredBaseURL: string
  private readonly contextSize: number | undefined
  private readonly memoryReserveMiB: number | undefined

  constructor(target: ResolvedLLMTarget) {
    const baseURL = CONFIG_MANAGER.getProviderBaseURL('llamacpp') || DEFAULT_LLAMACPP_BASE_URL

    super(
      {
        name: 'llama.cpp LLM Provider',
        providerName: 'llamacpp',
        apiKeyEnv: 'LEON_LLAMACPP_API_KEY',
        model: target.model,
        baseURL,
        flavor: 'openai-compatible',
        requiresApiKey: false,
        supportsStructuredOutputs: true,
        transformRequestBody: configureStructuredRequestThinking,
        buildProviderOptions: ({ completionParams, reasoningMode }) => ({
          llamacpp: {
            ...(completionParams.disableThinking || reasoningMode === 'off'
              ? { chat_template_kwargs: LLAMACPP_DISABLE_THINKING_CHAT_TEMPLATE_KWARGS }
              : {})
          }
        })
      }
    )

    if (!this.model.trim()) {
      throw new Error(
        'llama.cpp model path is not defined. Please configure llm.default in config.yml or install a default local LLM.'
      )
    }

    this.modelPath = resolveModelPath(this.model)
    this.configuredBaseURL = baseURL
    this.contextSize = CONFIG_MANAGER.getConfig().llm.providers?.llamacpp?.context_size
    this.memoryReserveMiB = CONFIG_MANAGER.getConfig().llm.providers?.llamacpp?.memory_reserve_mib
    LlamaCPPLLMProvider.instanceCount += 1
  }

  public override get modelName(): string {
    return this.modelPath
  }

  /**
   * Exposes only capacity verified together with native request token counting.
   */
  public get nativeContextWindowTokens(): number | undefined {
    return LlamaCPPLLMProvider.activeModelPath === this.modelPath &&
      LlamaCPPLLMProvider.configuredBaseURL === this.configuredBaseURL
      ? LlamaCPPLLMProvider.contextWindowTokens
      : undefined
  }

  /**
   * Gives the owner's whole turn priority without interrupting active work.
   */
  public beginForegroundTurn(): () => void {
    return LlamaCPPLLMProvider.inferenceScheduler.beginForegroundTurn()
  }

  /**
   * Defers auxiliary inference until the local slot and foreground turn permit it.
   * Queue timing stays separate from the provider's inference timeout and decode.
   */
  public async acquireInference(params: CompletionParams): Promise<() => void> {
    const purpose = params.usagePurpose ?? getActiveInferencePurpose()
    const priority = getTurnTimingContext()?.stage === TurnStage.PostTurn ||
      purpose === InferencePurpose.SessionTitle
      ? LocalInferencePriority.Background
      : LocalInferencePriority.Foreground
    const signal = params.cancellationSignal
      ? AbortSignal.any([
          params.cancellationSignal,
          ...(params.signal ? [params.signal] : [])
        ])
      : params.signal
    const startedAt = performance.now()
    const release = await runTurnPhase(TurnPhase.Wait, () =>
      LlamaCPPLLMProvider.inferenceScheduler.acquire(
        priority,
        signal
      )
    )
    LogHelper.debug(`Local inference queue | priority=${priority} | wait_ms=${Math.round(performance.now() - startedAt)}`)

    return release
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
      LogHelper.debug(
        'Using direct llama.cpp streaming chat completion for plain-text request.'
      )

      return this.runDirectPlainTextStreamingCompletion(prompt, completionParams)
    }

    if (completionParams.shouldStream !== true && isPlainTextRequest) {
      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.debug(
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
        ...LLAMACPP_DISABLE_THINKING_CHAT_TEMPLATE_KWARGS
      }
    }

    return payload
  }

  private buildDirectRequestConfig(
    completionParams: CompletionParams
  ): Record<string, unknown> {
    completionParams.signal?.throwIfAborted()
    const apiKey = CONFIG_MANAGER.getProviderAPIKey('llamacpp')

    this.recordInference(LlamaCPPLLMProvider.getChatCompletionsURL(), apiKey || undefined)

    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${
          apiKey || 'Bearer no-key'
        }`
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
    let promptTokens: number | undefined
    let hasPromptUsage = false
    let completionTokens: number | undefined
    let accounting: CompletionAccounting = {}
    let predictedPerSecond = 0
    let predictedMs = 0
    let finishReason = ''
    let buffer = ''
    let firstStreamBlockAt: number | null = null
    let lastStreamBlockAt: number | null = null

    const applyChunk = (chunk: Record<string, unknown>): void => {
      const usage =
        chunk['usage'] && typeof chunk['usage'] === 'object'
          ? (chunk['usage'] as Record<string, unknown>)
          : null
      if (usage) {
        accounting = { ...accounting, ...readCompletionAccounting(usage) }
        if (typeof usage['prompt_tokens'] === 'number') {
          promptTokens = usage['prompt_tokens'] as number
          hasPromptUsage = true
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
        // Timing counts exclude cached tokens; usage already contains the total.
        if (!hasPromptUsage && typeof timings['prompt_n'] === 'number') {
          promptTokens = timings['prompt_n'] +
            (typeof timings['cache_n'] === 'number' ? timings['cache_n'] : 0)
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

      recordInferenceUsage({
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        accounting
      })

      const choices = Array.isArray(chunk['choices'])
        ? (chunk['choices'] as Array<Record<string, unknown>>)
        : []
      const firstChoice = choices[0]
      if (!firstChoice || typeof firstChoice !== 'object') {
        return
      }

      const chunkFinishReason =
        firstChoice['finish_reason'] ?? firstChoice['finishReason']
      if (typeof chunkFinishReason === 'string' && chunkFinishReason) {
        finishReason = chunkFinishReason
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
              },
              ...(finishReason ? { finish_reason: finishReason } : {})
            }
          ],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            accounting
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
          LlamaCPPLLMProvider.configuredBaseURL === this.configuredBaseURL
            ? await LlamaCPPLLMProvider.probeServerReady(
                LlamaCPPLLMProvider.runtimeBaseURL,
                this.modelPath
              )
            : { ready: false }

        if (existingServerProbe.ready) {
          return
        }

        LlamaCPPLLMProvider.serverReady = false
        LlamaCPPLLMProvider.isUsingExternalServer = false
      }

      if (
        LlamaCPPLLMProvider.serverProcess &&
        !LlamaCPPLLMProvider.serverProcess.killed &&
        LlamaCPPLLMProvider.activeModelPath === this.modelPath &&
        LlamaCPPLLMProvider.configuredBaseURL === this.configuredBaseURL
      ) {
        return
      }
    }

    if (
      LlamaCPPLLMProvider.serverProcess &&
      (LlamaCPPLLMProvider.activeModelPath !== this.modelPath ||
        LlamaCPPLLMProvider.configuredBaseURL !== this.configuredBaseURL)
    ) {
      await LlamaCPPLLMProvider.disposeSharedServer()
    }

    if (LlamaCPPLLMProvider.serverReadyPromise) {
      await LlamaCPPLLMProvider.serverReadyPromise
      return this.ensureServerReady()
    }

    const startupPromise = LlamaCPPLLMProvider.startSharedServer(
      this.modelPath,
      this.configuredBaseURL,
      this.contextSize,
      this.memoryReserveMiB
    )
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

  private static async startSharedServer(
    modelPath: string,
    baseURL: string,
    contextSize: number | undefined,
    memoryReserveMiB: number | undefined
  ): Promise<void> {
    this.contextWindowTokens = undefined
    this.configuredBaseURL = baseURL
    const existingServerProbe = await this.probeServerReady(
      baseURL,
      modelPath
    )

    if (existingServerProbe.ready) {
      LogHelper.title('llama.cpp LLM Provider')
      LogHelper.info(
        `Reusing existing llama-server at "${toModelsURL(baseURL)}"`
      )
      this.writeServerLogLine(
        `Reusing existing llama-server at "${toModelsURL(baseURL)}".`
      )

      this.serverProcess = null
      this.activeModelPath = modelPath
      this.runtimeBaseURL = baseURL
      this.serverReady = true
      this.isUsingExternalServer = true

      return
    }

    const binaryPath = getLlamaCPPServerBinaryPath()

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
    const modelArguments = getLlamaCPPModelArguments(modelPath)
    const contextPlan = contextSize === undefined
      ? await resolveLlamaCPPContextPlan(binaryPath, modelArguments, memoryReserveMiB)
      : undefined
    const contextArguments = contextPlan?.arguments ?? ['--ctx-size', String(contextSize)]
    if (contextPlan) {
      const message = `Automatic llama.cpp context | tokens=${contextPlan.contextTokens} | estimated_mib=${contextPlan.estimatedMiB} | host_budget_mib=${contextPlan.hostBudgetMiB} | cache_mib=${contextPlan.cacheMiB}`
      LogHelper.info(message)
      this.writeServerLogLine(message)
    }

    // Check the port after memory inspection so fitting does not widen the
    // interval between checking availability and starting the native listener.
    const runtimeBaseURL = await this.resolveRuntimeBaseURL(baseURL)
    const runtimeServerURL = new URL(runtimeBaseURL)
    const serverProcess = spawn(
      binaryPath,
      [
        ...modelArguments,
        '--host',
        runtimeServerURL.hostname,
        '--port',
        String(getURLPort(runtimeServerURL)),
        ...contextArguments,
        '--jinja',
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
      this.contextWindowTokens = undefined
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
      this.writeServerLogLine(`Allocated context capacity: ${this.contextWindowTokens ?? 'unverified'} tokens.`)

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

      const readinessProbe = await this.probeServerReady(this.runtimeBaseURL, this.activeModelPath || undefined)
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

  private static async probeServerReady(baseURL: string, modelPath?: string): Promise<{
    ready: boolean
    errorMessage: string
  }> {
    try {
      const headers = { Authorization: `Bearer ${CONFIG_MANAGER.getProviderAPIKey('llamacpp') || 'no-key'}` }
      await axios.get(toModelsURL(baseURL), {
        timeout: 1_000,
        headers
      })

      if (modelPath) {
        const { data: props } = await axios.get(new URL('/props', baseURL).toString(), {
          timeout: LLAMACPP_METADATA_TIMEOUT_MS,
          headers
        })
        if (typeof props?.model_path !== 'string' || path.resolve(props.model_path) !== modelPath) {
          return { ready: false, errorMessage: 'The running llama.cpp server has a different model.' }
        }

        const capacity: unknown = props.default_generation_settings?.n_ctx
        this.contextWindowTokens = undefined
        if (typeof capacity === 'number' && Number.isSafeInteger(capacity) && capacity > 0) {
          // Independently hosted servers may predate the counting endpoint.
          // Only bypass estimates after verifying the complete native contract.
          try {
            const { data } = await axios.post(`${toChatCompletionsURL(baseURL)}/input_tokens`, {
              model: modelPath,
              messages: [{ role: 'user', content: '' }]
            }, { timeout: LLAMACPP_METADATA_TIMEOUT_MS, headers })
            this.contextWindowTokens = typeof data?.input_tokens === 'number' &&
              Number.isSafeInteger(data.input_tokens) && data.input_tokens >= 0
              ? capacity
              : undefined
          } catch {
            this.contextWindowTokens = undefined
          }
        }
      }

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
    this.contextWindowTokens = undefined

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

  private static async resolveRuntimeBaseURL(baseURL: string): Promise<string> {
    const configuredServerURL = new URL(baseURL)
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
          ? toBaseURL(baseURL)
          : withPort(baseURL, port)

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

      fs.mkdirSync(getProfilePaths().logs, { recursive: true })
      this.serverLogStream = fs.createWriteStream(getLlamaServerLogPath(), {
        flags
      })
      this.nextServerLogResetAt = nextResetAt

      return this.serverLogStream
    }

    if (now >= this.nextServerLogResetAt) {
      this.serverLogStream.end()
      this.serverLogStream = fs.createWriteStream(getLlamaServerLogPath(), {
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
    const llamaServerLogPath = getLlamaServerLogPath()

    if (!fs.existsSync(llamaServerLogPath)) {
      return {
        flags: 'w',
        nextResetAt: now + LLAMA_SERVER_LOG_RESET_INTERVAL_MS
      }
    }

    const { mtimeMs } = fs.statSync(llamaServerLogPath)

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
