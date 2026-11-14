import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import { terminateProcessTree } from '@sdk/utils/process'
import type { ToolExecutionContext } from '@sdk/tool-runtime-types'

const MAX_MESSAGE_BYTES = 10 * 1_024 * 1_024
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647
const MAX_DIAGNOSTIC_CHARACTERS = 16_000

/**
 * OpenScreen's decoded result, with rendered frames kept out of textual output.
 */
export interface OpenScreenResult {
  data: Record<string, unknown>
  images: { dataBase64: string, mediaType: string }[]
}

/**
 * Retains OpenScreen's recording clock, document checkpoints and editing session.
 */
export class OpenScreenSession {
  public closed = false
  private readonly client = new Client({ name: 'leon-openscreen', version: '1.0.0' })
  private readonly transport: StdioClientTransport
  private output: ((text: string) => void) | undefined
  private tail: Promise<void> = Promise.resolve()

  public constructor(executable: string, dataDirectory: string) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE'
      )
    )
    this.transport = new StdioClientTransport({
      command: executable,
      args: [`--user-data-dir=${dataDirectory}`, 'mcp'],
      env,
      stderr: 'pipe',
      maxBufferSize: MAX_MESSAGE_BYTES
    })
    this.transport.stderr?.on('data', (chunk: Buffer) => {
      this.output?.(chunk.toString().slice(-MAX_DIAGNOSTIC_CHARACTERS))
    })
    this.client.onclose = (): void => {
      this.closed = true
    }
  }

  /**
   * Negotiates the upstream protocol once, without exposing another agent loop.
   */
  public async connect(): Promise<void> {
    await this.client.connect(this.transport)
  }

  /**
   * Executes exactly once; cancellation closes the app so rendering cannot continue.
   */
  public call(
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
    onOutput?: (text: string) => void
  ): Promise<OpenScreenResult> {
    // Background duration expiry and foreground edits must not share stderr ownership.
    const pending = this.tail.then(() => this.perform(name, args, context, onOutput))
    this.tail = pending.then(() => {}, () => {})
    return pending
  }

  private async perform(
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
    onOutput?: (text: string) => void
  ): Promise<OpenScreenResult> {
    context?.signal?.throwIfAborted()
    this.output = onOutput

    try {
      const result = await this.client.callTool({ name, arguments: args }, {
        ...(context?.signal ? { signal: context.signal } : {}),
        // Leon's host already owns idle and total execution deadlines.
        timeout: MAX_REQUEST_TIMEOUT_MS,
        onprogress: (progress) => onOutput?.(`${JSON.stringify(progress)}\n`)
      })
      const texts = result.content.flatMap((item) => item.type === 'text' ? [item.text] : [])
      const text = texts.join('\n')
      if (result.isError) {
        throw new Error(text || 'OpenScreen rejected the operation.')
      }

      let data: Record<string, unknown> = { message: text }
      if (texts.length) {
        // Upstream adds human-readable notes after some single-line JSON results.
        try {
          data = JSON.parse(texts[0]!) as Record<string, unknown>
        } catch {
          try {
            data = JSON.parse(texts[0]!.split('\n')[0]!) as Record<string, unknown>
            data['message'] = text.slice(text.indexOf('\n') + 1)
          } catch {
            // Keep upstream diagnostics when a successful operation has no JSON body.
          }
        }
      }

      return {
        data,
        images: result.content.flatMap((item) => item.type === 'image'
          ? [{ dataBase64: item.data, mediaType: item.mimeType }]
          : [])
      }
    } catch (error) {
      if (context?.signal?.aborted) {
        await this.dispose()
      }
      throw error
    } finally {
      this.output = undefined
    }
  }

  /**
   * Releases the complete app process tree, including capture and renderer helpers.
   */
  public async dispose(): Promise<void> {
    const pid = this.transport.pid
    this.closed = true
    try {
      if (pid) {
        await terminateProcessTree(pid, 'SIGTERM')
      }
    } finally {
      await this.client.close()
    }
  }
}
