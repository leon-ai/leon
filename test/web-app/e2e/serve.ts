import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

import { build, preview, type PreviewServer } from 'vite'
import { renderWebAppDocument } from '../../../server/src/core/http-server/web-app-document'

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-ui-e2e-'))
const profileName = 'ui-tests'
const profilePath = path.join(testHome, 'profiles', profileName)
const port = Number(process.env['WEB_APP_TEST_PORT'])
let server: PreviewServer | undefined
let closing = false
const streams = new Map<string, ServerResponse>()
const MAXIMUM_TEST_EVENT_CHARACTERS = 1_048_576

async function cleanup(): Promise<void> {
  if (closing) {
    return
  }
  closing = true
  if (server && 'closeAllConnections' in server.httpServer) {
    server.httpServer.closeAllConnections()
  }
  await server?.close()
  streams.clear()
  // Only the directory returned by mkdtemp belongs to this test process.
  await fs.rm(testHome, { recursive: true, force: true })
}

process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(0))
})
process.once('SIGINT', () => {
  void cleanup().finally(() => process.exit(0))
})

try {
  // Establish isolation before Vite evaluates Leon's environment-derived paths.
  process.env['LEON_HOME'] = testHome
  process.env['LEON_PROFILE'] = profileName
  await fs.mkdir(profilePath, { recursive: true })
  await fs.writeFile(path.join(profilePath, 'config.yml'), 'server:\n  host: http://127.0.0.1\n  port: 1\n')
  const configFile = 'apps/web/vite.config.ts'
  const outDir = path.join(testHome, 'web-dist')
  await build({ configFile, build: { outDir } })
  server = await preview({
    configFile,
    base: '/web-app/',
    build: { outDir },
    preview: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{
      name: 'isolated-ui-test-transport',
      configurePreviewServer: (previewServer): void => {
        previewServer.middlewares.use((request, response, next) => {
          const requestPath = request.url?.split('?')[0] ?? ''
          const bootstrap = request.headers['x-ui-bootstrap']
          if (bootstrap && requestPath.startsWith('/web-app/') &&
            (!path.extname(requestPath) || requestPath.endsWith('/index.html'))) {
            // Controlled fixture identity exercises the production HTML serializer.
            const authenticated = bootstrap === 'authenticated'
            void fs.readFile(path.join(outDir, 'index.html'), 'utf8').then((html) => {
              response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' })
              response.end(renderWebAppDocument(html, {
                authenticated, profile_name: authenticated ? profileName : null
              }))
            }, next)
            return
          }
          if (request.url?.startsWith('/api/v1/sessions/events')) {
            // Keep the native EventSource alive without replacing browser APIs.
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
            response.write(': connected\n\n')
            const streamId = new URL(request.url, 'http://localhost').searchParams.get('ui_stream')
            if (streamId) {
              streams.set(streamId, response)
              response.once('close', () => {
                if (streams.get(streamId) === response) {
                  streams.delete(streamId)
                }
              })
            }
            return
          }
          if (request.method === 'POST' && requestPath.startsWith('/__ui/events/')) {
            const target = streams.get(requestPath.split('/').at(-1) ?? '')
            if (!target) {
              response.writeHead(409).end()
              return
            }
            let body = ''
            request.on('data', (chunk: Buffer) => {
              body += chunk.toString()
              if (body.length > MAXIMUM_TEST_EVENT_CHARACTERS) {
                request.destroy()
              }
            })
            request.on('end', () => {
              for (const event of JSON.parse(body) as unknown[]) {
                target.write(`data: ${JSON.stringify(event)}\n\n`)
              }
              response.writeHead(204).end()
            })
            return
          }
          if (request.url?.startsWith('/api/')) {
            // Unhandled test requests must never reach an owner's server.
            response.writeHead(500, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ message: 'No UI fixture handles this request.' }))
            return
          }
          next()
        })
      }
    }]
  })
} catch (error) {
  await cleanup()
  throw error
}
