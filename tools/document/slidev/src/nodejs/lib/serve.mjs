import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 3030
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm'
}
const port = Number(process.argv[2] || DEFAULT_PORT)

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('Provide a port between 0 and 65535; zero selects a free port.')
}

// A downloaded deck can be presented without installing a package manager or
// exposing Leon's authenticated application origin to its generated scripts.
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const filename = await fs.realpath(path.join(ROOT, pathname === '/' ? 'index.html' : pathname))
    const relative = path.relative(ROOT, filename)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end()
      return
    }

    const bytes = await fs.readFile(filename)

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filename)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    }).end(bytes)
  } catch {
    response.writeHead(404).end()
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Present at http://127.0.0.1:${server.address().port}`)
})
