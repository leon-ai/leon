import { fileURLToPath } from 'node:url'

const CLI_PATH = fileURLToPath(new URL('../node_modules/@slidev/cli/bin/slidev.mjs', import.meta.url))
const [entry] = process.argv.slice(2)
const REQUEST_TIMEOUT_MS = 10_000

// Resolve themes and local icon collections from the tool-owned installation.
process.argv[1] = CLI_PATH

let server
let closing = false
const startup = start()

/**
 * The worker owns this server: losing its IPC connection must release the port.
 */
async function shutdown() {
  if (closing) {
    return
  }

  closing = true
  await startup.catch(() => {})
  await server?.close()
  process.exit(0)
}

process.once('disconnect', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())

/**
 * Serve the editable deck with Slidev's native audience and presenter routes.
 */
async function start() {
  const { createServer, resolveOptions } = await import('@slidev/cli')
  const options = await resolveOptions({ entry }, 'dev')

  server = await createServer(options, {
    server: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'warn'
  })
  await server.listen()

  const audienceUrl = `http://127.0.0.1:${server.httpServer.address().port}/`
  const presenterUrl = `${audienceUrl}presenter`

  for (const url of [audienceUrl, presenterUrl]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })

    await response.text()

    if (!response.ok) {
      throw new Error(`Presentation route returned HTTP ${response.status}.`)
    }
  }

  if (process.connected && !closing) {
    process.send({ audienceUrl, presenterUrl })
  }
}

startup.catch(async (error) => {
  console.error(error)
  await server?.close()
  process.exit(1)
})
