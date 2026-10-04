import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

import execa from 'execa'
import { parsePartialJson } from 'ai'
import type { AxiosResponse } from 'axios'

import { ajv } from '@/ajv'
import { getClaudeSubscriptionEnvironment } from '../fellows/fellow-catalog'
import type { ResolvedLLMTarget } from '../llm-routing'
import type { CompletionParams, PromptOrChatHistory, AgentModelFile } from '../types'

const CLI_MAX_BUFFER = 16_777_216
const CLI_MAX_TURNS = '3'
const LEON_MODEL_INSTRUCTIONS =
  'You provide one model response for Leon. Leon executes the tools. Return the requested structured response; do not execute tools yourself.'
const STREAM_OUTPUT_INSTRUCTIONS =
  'Return only one JSON object matching this schema, without markdown or other text. Put the answer in text before tool_calls. Do not execute tools.'

interface ClaudeResult {
  type: string
  subtype: string
  is_error?: boolean
  result?: string
  structured_output?: Record<string, unknown>
  usage?: { input_tokens?: number, output_tokens?: number }
  event?: {
    type: string
    delta?: { type: string, text?: string, thinking?: string }
  }
}

/**
 * Adapt Anthropic requests to the unmodified Claude Code CLI and its own
 * subscription authentication. Anthropic remains the selected LLM provider.
 * Structured output carries a single model decision back to Leon's existing
 * tool loop; Claude receives no executable Leon tools or MCP servers.
 */
export default class AnthropicClaudeCodeAdapter {
  public readonly modelName: string
  private readonly configDirectory: string

  public constructor(target: ResolvedLLMTarget, credentials: Record<string, unknown>) {
    this.modelName = target.model
    this.configDirectory = String(credentials['config_directory'] || '')
  }

  private fileParts(files: AgentModelFile[]): Record<string, unknown>[] {
    return files.map((file) => {
      if (!file.mediaType.startsWith('image/') && file.mediaType !== 'application/pdf') {
        throw new Error('This Claude subscription connection supports text, images, and PDF files.')
      }

      return {
        type: file.mediaType === 'application/pdf' ? 'document' : 'image',
        source: { type: 'base64', media_type: file.mediaType, data: file.dataBase64 }
      }
    })
  }

  /**
   * Request only a response or tool decisions, then let Core execute those decisions.
   */
  public async runChatCompletion(
    prompt: PromptOrChatHistory,
    params: CompletionParams
  ): Promise<AxiosResponse> {
    const tools = params.toolChoice === 'none' ? [] : params.tools || []
    const forcedName = typeof params.toolChoice === 'object'
      ? params.toolChoice.function.name : ''
    const allowedTools = forcedName
      ? tools.filter((tool) => tool.function.name === forcedName) : tools
    const callsRequired = params.toolChoice === 'required' || Boolean(forcedName)
    const structuredTools = {
      type: 'object',
      properties: {
        text: { type: 'string' },
        tool_calls: {
          type: 'array',
          minItems: callsRequired ? 1 : 0,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', ...(allowedTools.length
                ? { enum: allowedTools.map((tool) => tool.function.name) } : {}) },
              arguments: { type: 'object', additionalProperties: true }
            },
            required: ['name', 'arguments'],
            additionalProperties: false
          },
          ...(allowedTools.length ? {} : { maxItems: 0 })
        }
      },
      required: ['text', 'tool_calls'],
      additionalProperties: false
    }
    const schema = tools.length ? structuredTools : params.data
      ? ('type' in params.data ? params.data : { type: 'object', properties: params.data })
      : structuredTools
    const files = typeof prompt === 'string' ? [] : prompt.flatMap((message) =>
      'files' in message ? message.files || [] : [])
    // Keep the transcript's tool IDs/results intact without embedding base64 in text.
    const transcript = typeof prompt === 'string' ? prompt : JSON.stringify(prompt.map((message) => {
      const copy = { ...message }
      if ('files' in copy) {
        delete copy.files
      }
      return copy
    }))
    const input = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: transcript }, ...this.fileParts(files)]
      }
    }) + '\n'
    const env = getClaudeSubscriptionEnvironment(this.configDirectory)
    const streamText = params.shouldStream === true && (tools.length > 0 || !params.data)
    const validate = streamText ? ajv.compile(schema) : null

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-claude-'))
    let command: execa.ExecaChildProcess<string> | undefined
    let lines: ReturnType<typeof createInterface> | undefined
    const closeStream = (): void => {
      lines?.close()
    }

    try {
      params.signal?.throwIfAborted()
      // Keep full tool schemas in a file; Windows limits command-line length.
      // Core validates returned arguments against these schemas before execution.
      const systemPromptFile = path.join(directory, 'system-prompt.txt')
      await fs.writeFile(systemPromptFile, [
        params.systemPrompt,
        LEON_MODEL_INSTRUCTIONS,
        JSON.stringify(allowedTools),
        ...(streamText ? [STREAM_OUTPUT_INSTRUCTIONS, JSON.stringify(schema)] : [])
      ].join('\n'))

      command = execa('claude', [
        '--print', '--verbose', '--input-format', 'stream-json',
        '--output-format', 'stream-json', '--model', this.modelName,
        '--system-prompt-file', systemPromptFile,
        ...(streamText ? ['--include-partial-messages'] : ['--json-schema', JSON.stringify(schema)]),
        '--tools', '',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--safe-mode', '--setting-sources', '', '--no-session-persistence', '--max-turns', CLI_MAX_TURNS
      ], {
        cwd: directory,
        env,
        extendEnv: false,
        input,
        maxBuffer: CLI_MAX_BUFFER,
        ...(params.timeout ? { timeout: params.timeout } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
        reject: false
      })
      // Observe process failures while reading stdout, then await exit below.
      void command.catch(() => undefined)
      let completed: ClaudeResult | undefined
      let streamedJSON = ''
      let streamedText = ''

      if (!command.stdout) {
        throw new Error('Claude Code did not open its response stream.')
      }

      lines = createInterface({ input: command.stdout, crlfDelay: Infinity })
      // Execa can destroy stdout on abort or timeout without ending the line reader.
      command.stdout.once('close', closeStream)
      params.signal?.addEventListener('abort', closeStream, { once: true })
      params.signal?.throwIfAborted()
      if (streamText) {
        params.onToken?.('')
        params.onStreamEvent?.({ type: 'stream-open' })
      }

      for await (const line of lines) {
        if (!line.trim()) {
          continue
        }

        const message = JSON.parse(line) as ClaudeResult
        if (message.type === 'result') {
          completed = message
        }

        const event = message.event
        if (!streamText || message.type !== 'stream_event' || !event) {
          continue
        }

        params.onStreamEvent?.({ type: event.type })
        if (event.type === 'message_start') {
          // A retried model message replaces provisional output from its predecessor.
          streamedJSON = ''
          streamedText = ''
          params.onToken?.('')
        }

        if (event.delta?.type === 'thinking_delta') {
          params.onReasoningToken?.(event.delta.thinking || '')
        }

        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          streamedJSON += event.delta.text || ''
          const { value } = await parsePartialJson(streamedJSON)
          const text = value && typeof value === 'object' && !Array.isArray(value)
            ? value['text'] : undefined

          // Decode JSON escapes through the existing SDK; never show tool arguments.
          if (typeof text === 'string' && text.startsWith(streamedText)) {
            const delta = text.slice(streamedText.length)
            if (delta) {
              streamedText = text
              params.onToken?.(delta)
            }
          }
        }
      }

      const response = await command
      params.signal?.throwIfAborted()

      if (response.exitCode !== 0 || !completed || completed.is_error || completed.subtype !== 'success') {
        throw new Error('I could not use your Claude subscription. Check claude auth status or reconnect with /connection ai connect anthropic.')
      }
      // Streaming schema mode is not supported by the CLI. Validate the final
      // JSON before Core receives any tool decisions; partial values are display-only.
      const output = streamText
        ? JSON.parse(completed.result || streamedJSON) as Record<string, unknown>
        : completed.structured_output
      if (!output || (validate && !validate(output))) {
        throw new Error('Claude Code did not return the requested structured response.')
      }
      const calls = tools.length ? output['tool_calls'] as { name: string, arguments: unknown }[] : []
      const text = tools.length || !params.data ? String(output['text'] || '') : JSON.stringify(output)
      if (streamText && text.startsWith(streamedText)) {
        const remaining = text.slice(streamedText.length)
        if (remaining) {
          params.onToken?.(remaining)
        }
      } else {
        if (streamText) {
          params.onToken?.('')
        }
        params.onToken?.(text)
      }

      return { data: {
        choices: [{
          finish_reason: calls?.length ? 'tool_calls' : 'stop',
          message: {
            content: text,
            tool_calls: (calls || []).map((call) => ({
              id: randomUUID(),
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) }
            }))
          }
        }],
        usage: {
          prompt_tokens: completed.usage?.input_tokens || 0,
          completion_tokens: completed.usage?.output_tokens || 0
        }
      } } as AxiosResponse
    } catch {
      params.signal?.throwIfAborted()
      throw new Error('I could not use Claude Code. Check claude auth status and update Claude Code, then try again.')
    } finally {
      // Stop the CLI before removing its prompt file after malformed output or abort.
      params.signal?.removeEventListener('abort', closeStream)
      command?.stdout?.removeListener('close', closeStream)
      closeStream()
      command?.kill()
      await command?.catch(() => undefined)
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}
