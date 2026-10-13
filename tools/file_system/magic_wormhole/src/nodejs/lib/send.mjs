import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

const MAX_OUTPUT_CHARS = 8_000
const TRANSFER_PROTOCOL = 'wormhole-transfer:'
const TERMINAL_ESCAPE = '\u001b'
let sender
let directory
let timer
let stopping = false

// IPC disconnect also fires when the retained tool worker is forcibly killed.
async function stop(status) {
  if (stopping) {
    return
  }

  stopping = true
  clearTimeout(timer)
  if (sender && sender.exitCode === null && sender.signalCode === null) {
    const closed = new Promise((resolve) => sender.once('close', resolve))
    sender.kill('SIGKILL')
    await closed
  }

  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
  if (process.connected) {
    process.send({ status }, () => process.exit(0))
  } else {
    process.exit(0)
  }
}

process.once('disconnect', () => void stop('stopped'))
process.once('SIGTERM', () => void stop('stopped'))
process.once('SIGINT', () => void stop('stopped'))
process.once('message', (input) => {
  directory = input.directory
  let output = ''
  let announced = false

  try {
    // Keep inherited CLI relay settings from silently changing the recipient's
    // mailbox or routing. The upstream defaults interoperate with the browser.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith('WORMHOLE_')
    ))
    sender = spawn(input.binary, ['send', '--no-qr', '--no-color', '--code-length', '4',
      '--', input.file], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    const consume = (chunk) => {
      output = (output + chunk).slice(-MAX_OUTPUT_CHARS)
      if (announced) {
        return
      }

      // Parse the protocol URI instead of matching English CLI status messages.
      // The CLI wraps it in an OSC hyperlink even when colors are disabled.
      const start = output.indexOf(TRANSFER_PROTOCOL)
      const end = output.indexOf(TERMINAL_ESCAPE, start)
      if (start !== -1 && end > start && process.connected) {
        const uri = new URL(output.slice(start, end))
        if (uri.protocol === TRANSFER_PROTOCOL && uri.pathname) {
          announced = true
          process.send({ code: uri.pathname, transferUri: uri.href })
        }
      }
    }
    sender.stdout.on('data', consume)
    sender.stderr.on('data', consume)
    sender.once('error', () => void stop('failed'))
    sender.once('close', (code) => {
      if (!stopping) {
        void stop(code === 0 && announced ? 'completed' : 'failed')
      }
    })
    timer = setTimeout(() => void stop('expired'),
      Math.max(0, Date.parse(input.expiresAt) - Date.now()))
  } catch {
    void stop('failed')
  }
})
