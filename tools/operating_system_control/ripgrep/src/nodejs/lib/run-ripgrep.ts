import { spawn } from 'node:child_process'

const MAX_OUTPUT_BYTES = 128 * 1_024 * 1_024
const MAX_RECORD_BYTES = 8 * 1_024 * 1_024
const MAX_ERROR_BYTES = 16 * 1_024

/**
 * Stream records without a shell. The SDK command helper does not expose exit
 * codes or a streaming stop hook; rg uses exit 1 for a successful empty search.
 */
export async function runRipgrep(
  binary: string,
  args: string[],
  timeoutMs: number,
  separator: number,
  consume: (record: Buffer) => boolean | Promise<boolean>,
  signal?: AbortSignal
): Promise<{ truncated: boolean, reason: string | null }> {
  if (signal?.aborted) {
    throw new Error('ripgrep execution canceled')
  }

  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true
  })
  let pending = Buffer.alloc(0)
  let outputBytes = 0
  let stderr = Buffer.alloc(0)
  let reason: string | null = null
  const closed = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    error?: Error
  }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const stop = (why: string): void => {
    if (reason) {
      return
    }

    reason = why
    child.kill('SIGKILL')
  }
  const cancel = (): void => stop('canceled')
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => stop('timeout'), timeoutMs)
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk.subarray(0, MAX_ERROR_BYTES - stderr.length)])
  })

  try {
    // Await the sink so disk backpressure also bounds stdout buffering.
    for await (const chunk of child.stdout) {
      if (reason) {
        break
      }

      outputBytes += chunk.length
      const remaining = MAX_OUTPUT_BYTES - (outputBytes - chunk.length)
      const data = Buffer.concat([pending, chunk.subarray(0, Math.max(0, remaining))])
      let start = 0

      for (let end = data.indexOf(separator); end !== -1; end = data.indexOf(separator, start)) {
        if (end - start > MAX_RECORD_BYTES) {
          stop('recordSizeLimit')
          break
        }
        if (reason || !(await consume(data.subarray(start, end)))) {
          stop('recordLimit')
          break
        }

        start = end + 1
      }

      pending = data.subarray(start)
      if (pending.length > MAX_RECORD_BYTES) {
        stop('recordSizeLimit')
      }
      if (outputBytes > MAX_OUTPUT_BYTES) {
        stop('outputLimit')
      }
    }

    const outcome = await closed

    if (outcome.error) {
      throw new Error(`Cannot run ripgrep binary ${binary}: ${outcome.error.message}`)
    }
    // Never present a read error or invalid regex as an empty, complete search.
    if (outcome.code !== null && outcome.code !== 0 && outcome.code !== 1) {
      throw new Error(`ripgrep exited with code ${outcome.code}: ${stderr.toString('utf8').trim()}`)
    }
    if (!reason && outcome.signal) {
      throw new Error(`ripgrep terminated by ${outcome.signal}`)
    }
    if (!reason && pending.length) {
      throw new Error('Incomplete ripgrep output record')
    }

    return { truncated: reason !== null, reason }
  } catch (error) {
    child.kill('SIGKILL')
    await closed
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
