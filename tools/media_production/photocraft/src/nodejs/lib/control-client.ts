import net from 'node:net'

const MAX_REQUEST_BYTES = 1_048_576
const MAX_REPLY_BYTES = 8_388_608

/**
 * Authenticates a single bounded request to PhotoCraft's IPv4 loopback listener.
 * Closing or timing out a socket does not roll back an already delivered edit.
 */
export async function requestControl(
  port: number,
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const request = JSON.stringify({ id: 'request', method, params }) + '\n'

  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
    throw new Error('PhotoCraft request exceeds the 1 MiB protocol limit.')
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let buffer = Buffer.alloc(0)
    let authenticated = false
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error('PhotoCraft timed out. The request may have taken effect; inspect before retrying.'))
    }, timeoutMs)

    const finish = (error: Error | null, result?: unknown): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      socket.destroy()

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 'auth', method: 'auth', params: { token } }) + '\n')
    })
    socket.on('error', () => {
      finish(new Error('Cannot connect to PhotoCraft control. Check the app, port and private token file.'))
    })
    socket.on('close', () => {
      finish(new Error('PhotoCraft closed the connection. Inspect state before retrying a delivered edit.'))
    })
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      let newline = buffer.indexOf(10)

      while (newline !== -1 && !settled) {
        if (newline > MAX_REPLY_BYTES) {
          finish(new Error('PhotoCraft reply exceeds the 8 MiB protocol limit.'))
          return
        }

        let reply: { id?: unknown, ok?: unknown, result?: unknown, error?: unknown }

        try {
          reply = JSON.parse(buffer.subarray(0, newline).toString('utf8'))
          if (!reply || typeof reply !== 'object') {
            throw new Error('Invalid reply')
          }
        } catch {
          finish(new Error('PhotoCraft returned an invalid JSON reply.'))
          return
        }

        buffer = buffer.subarray(newline + 1)
        const expectedId = authenticated ? 'request' : 'auth'

        if (reply.id !== expectedId) {
          finish(new Error('PhotoCraft returned an unexpected reply id.'))
          return
        }
        if (reply.ok !== true) {
          // Authentication errors must never echo the credential or raw frame.
          const message = authenticated && typeof reply.error === 'string'
            ? reply.error.split(token).join('[redacted]')
            : 'Control authentication failed.'

          finish(new Error(`PhotoCraft: ${message}`))
          return
        }
        if (!authenticated) {
          authenticated = true
          socket.write(request)
        } else {
          finish(null, reply.result)
        }

        newline = buffer.indexOf(10)
      }

      if (!settled && buffer.length > MAX_REPLY_BYTES) {
        finish(new Error('PhotoCraft reply exceeds the 8 MiB protocol limit.'))
      }
    })
  })
}
