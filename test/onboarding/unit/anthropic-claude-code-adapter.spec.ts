import fs from 'node:fs/promises'
import { PassThrough, Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import AnthropicClaudeCodeAdapter from '@/core/llm-manager/llm-providers/anthropic-claude-code-adapter'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

const cli = vi.hoisted(() => vi.fn())
vi.mock('execa', () => ({ default: cli }))

describe('Anthropic Claude Code adapter', () => {
  it('returns tool decisions for Core and disables executable CLI tools', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'other-account-key')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'other-account-token')
    let temporaryDirectory = ''
    cli.mockImplementationOnce((_command, args, options) => {
      const result = (async (): Promise<{ exitCode: number }> => {
        temporaryDirectory = options.cwd
        expect(args).toEqual(expect.arrayContaining([
          '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence'
        ]))
        expect(options.env.ANTHROPIC_API_KEY).toBeUndefined()
        expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
        expect(options.extendEnv).toBe(false)
        const file = args[args.indexOf('--system-prompt-file') + 1]
        expect(await fs.readFile(file, 'utf8')).toContain('Leon executes the tools')
        expect(JSON.parse(options.input).message.content[0].text).toContain('Read my note.')

        return { exitCode: 0 }
      })()

      return Object.assign(result, {
        stdout: Readable.from([JSON.stringify({
          type: 'result', subtype: 'success', structured_output: {
            text: '', tool_calls: [{ name: 'read_note', arguments: { name: 'todo' } }]
          }, usage: {
            input_tokens: 12, output_tokens: 4,
            cache_read_input_tokens: 80, cache_creation_input_tokens: 10
          }
        }) + '\n']),
        kill: vi.fn()
      })
    })
    const provider = new AnthropicClaudeCodeAdapter({
      provider: LLMProviders.Anthropic, model: 'sonnet', label: 'anthropic/sonnet',
      isLocal: false, isEnabled: true, isResolved: true
    }, { config_directory: '/example/claude' })
    const result = await provider.runChatCompletion('Read my note.', {
      dutyType: LLMDuties.ReAct, systemPrompt: 'Help the owner.', data: null,
      tools: [{ type: 'function', function: {
        name: 'read_note', description: 'Read a note',
        parameters: { type: 'object', properties: { name: { type: 'string' } } }
      } }]
    })

    expect(result.data.choices[0].message.tool_calls[0].function).toEqual({
      name: 'read_note', arguments: '{"name":"todo"}'
    })
    expect(result.data.usage).toEqual({
      prompt_tokens: 102, completion_tokens: 4,
      accounting: { cachedInputTokens: 80, cacheWriteInputTokens: 10 }
    })
    expect(await fs.stat(temporaryDirectory).catch(() => null)).toBeNull()
  })

  it.each([false, true])('streams answer text before exit and validates tool decisions (invalid: %s)', async (invalid) => {
    const stdout = new PassThrough()
    let finish!: (result: { exitCode: number }) => void
    const exit = new Promise<{ exitCode: number }>((resolve) => {
      finish = resolve
    })
    const kill = vi.fn(() => finish({ exitCode: 1 }))
    cli.mockImplementationOnce((_command, args) => {
      expect(args).toContain('--include-partial-messages')
      expect(args).not.toContain('--json-schema')
      return Object.assign(exit, { stdout, kill })
    })
    const provider = new AnthropicClaudeCodeAdapter({
      provider: LLMProviders.Anthropic, model: 'sonnet', label: 'anthropic/sonnet',
      isLocal: false, isEnabled: true, isResolved: true
    }, { config_directory: '/example/claude' })
    const onToken = vi.fn()
    const onReasoningToken = vi.fn()
    const completion = provider.runChatCompletion('Read my note.', {
      dutyType: LLMDuties.ReAct, systemPrompt: 'Help the owner.', data: null,
      shouldStream: true, onToken, onReasoningToken,
      tools: [{ type: 'function', function: {
        name: 'read_note', description: 'Read a note',
        parameters: { type: 'object', properties: { name: { type: 'string' } } }
      } }]
    })
    void completion.catch(() => undefined)
    await vi.waitFor(() => expect(cli).toHaveBeenCalledTimes(1))
    const event = (delta: object): string => JSON.stringify({
      type: 'stream_event', event: { type: 'content_block_delta', delta }
    }) + '\n'
    const first = event({ type: 'text_delta', text: '{"text":"Hello' })
    stdout.write(first.slice(0, 13))
    stdout.write(first.slice(13))
    await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith('Hello'))
    expect(onToken.mock.calls.map(([text]) => text).join('')).toBe('Hello')

    stdout.write(event({ type: 'thinking_delta', thinking: 'Checking the note.' }))
    stdout.write(event({ type: 'text_delta', text: '\\n\\u26' }))
    stdout.write(event({ type: 'text_delta', text: '3a","tool_calls":[' }))
    await vi.waitFor(() => expect(onToken.mock.calls.map(([text]) => text).join('')).toBe('Hello\n☺'))
    const output = {
      text: 'Hello\n☺', tool_calls: [{
        name: invalid ? 'unexpected_tool' : 'read_note', arguments: { name: 'todo' }
      }]
    }
    stdout.write(event({ type: 'text_delta', text: JSON.stringify(output.tool_calls).slice(1) + '}' }))
    stdout.end(JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify(output) }))
    finish({ exitCode: 0 })

    if (invalid) {
      await expect(completion).rejects.toThrow('could not use Claude Code')
    } else {
      const result = await completion
      expect(result.data.choices[0].message.content).toBe('Hello\n☺')
      expect(result.data.choices[0].message.tool_calls[0].function.name).toBe('read_note')
    }
    expect(onReasoningToken).toHaveBeenCalledWith('Checking the note.')
    expect(onToken.mock.calls.map(([text]) => text).join('')).toBe('Hello\n☺')
    expect(kill).toHaveBeenCalled()
  })

  it('stops a real streaming process on abort and removes its prompt file', async () => {
    const { default: execa } = await vi.importActual<typeof import('execa')>('execa')
    const controller = new AbortController()
    const onToken = vi.fn()
    let directory = ''
    cli.mockImplementationOnce((_command, _args, options) => {
      directory = options.cwd
      const message = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '{"text":"Hello' }
        }
      }) + '\n'

      // A local fixture process exercises pipe framing and execa cancellation
      // without calling Claude or using any account credentials.
      return execa(process.execPath, ['-e', `
        process.stdout.write(${JSON.stringify(message)});
        setInterval(() => {}, 1000);
      `], options)
    })
    const provider = new AnthropicClaudeCodeAdapter({
      provider: LLMProviders.Anthropic, model: 'sonnet', label: 'anthropic/sonnet',
      isLocal: false, isEnabled: true, isResolved: true
    }, { config_directory: '/example/claude' })
    const completion = provider.runChatCompletion('Hello.', {
      dutyType: LLMDuties.ReAct, systemPrompt: 'Help the owner.', data: null,
      shouldStream: true, onToken, signal: controller.signal, timeout: 2_000
    })
    void completion.catch(() => undefined)

    await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith('Hello'))
    controller.abort()
    await expect(completion).rejects.toMatchObject({ name: 'AbortError' })
    expect(await fs.stat(directory).catch(() => null)).toBeNull()
  })
})
