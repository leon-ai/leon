import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { once } from 'node:events'
import { Readable } from 'node:stream'

import { requestBackend, readBackendJSON } from './backend.js'
import { createFileStore } from './files.js'
import { assertCoreUpdateCompatibility } from './compatibility.js'
import contract from '../runtime/desktop-contract.mjs'
import { DESKTOP_BOOTSTRAP_META_NAME, DESKTOP_BOOTSTRAP_PATH, DESKTOP_NOTIFICATION_PATH } from '../../../bridges/runtime/contracts/desktop-client'
import { TURN_CLIENT_OS_HEADER, TURN_CLIENT_TYPE_HEADER, TurnClientOS, TurnClientType } from '../../../bridges/runtime/contracts/turn-client'
import type { Session } from 'electron'
import type { HostAPI, HostError, FileGrants } from './types.js'
import type { createDesktopState } from './state.js'

interface GatewayOptions {
  frontend: string | (() => Promise<string>)
  backendOrigin?: string
  backendSession?: Session
  reportPath?: string | undefined
  onDiagnosticPaste?: (() => Promise<void>) | undefined
  onDiagnosticWindow?: ((action: 'status' | 'close' | 'activate' | 'quit' | 'resize' | 'hide' | 'hide-popup') => object) | undefined
  state?: Awaited<ReturnType<typeof createDesktopState>>
  bootstrap?: HostAPI
  desktopUpdates?: HostAPI
  bootstrapPhase?: () => string
  notifications?: HostAPI
}
export interface Gateway {
  origin: string
  entry: string
  grantFiles: (paths: string[]) => Promise<FileGrants>
  close: () => void
}

const MAXIMUM_REQUEST_BYTES = 8 * 1_024 * 1_024
const SESSION_COOKIE = 'leon-desktop-session'
const FRONTEND_INDEX = 'index.html'
const OWNER_TURN_PATH = /^\/api\/v1\/sessions\/[^/]+\/messages(?:\/[^/]+\/ui)?$/
const CLIENT_OS_BY_PLATFORM: Readonly<Partial<Record<NodeJS.Platform, TurnClientOS>>> = {
  darwin: TurnClientOS.MacOS,
  linux: TurnClientOS.Linux,
  win32: TurnClientOS.Windows
}
// Aurora's opaque Blob frames inherit this policy and additionally restrict
// their own resources. Only trusted bootstrap scripts receive the page nonce.
const CONTENT_SECURITY_POLICY = 'default-src \'self\'; script-src \'self\' blob: \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\' data:; media-src \'self\' blob:; worker-src \'self\' blob:; connect-src \'self\'; frame-src blob:; frame-ancestors \'none\'; object-src \'none\'; base-uri \'self\'; form-action \'self\''
const REQUEST_HEADERS = ['accept', 'content-type', 'range', 'if-none-match', 'if-modified-since', 'if-range', 'last-event-id']
const RESPONSE_HEADERS = ['content-security-policy', 'referrer-policy', 'x-frame-options', 'location', 'content-type', 'cache-control', 'content-disposition', 'etag', 'content-range', 'accept-ranges', 'last-modified']
const MIME_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' }

/**
 * Collects bounded upload bodies while leaving response streams unbuffered.
 */
async function readBody(request: IncomingMessage, maximumBytes = MAXIMUM_REQUEST_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximumBytes) {
      throw Object.assign(new Error('Request body too large'), { status: 413 })
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Owns one loopback origin, private backend cookies and streamed API responses.
 */
export async function createGateway({ frontend, backendOrigin, backendSession, reportPath, onDiagnosticPaste, onDiagnosticWindow, state, bootstrap, desktopUpdates,
  bootstrapPhase, notifications }: GatewayOptions): Promise<Gateway> {
  if (typeof frontend !== 'function') {
    frontend = path.resolve(frontend)
  }
  const backend = new URL(backendOrigin ?? 'http://127.0.0.1')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)
  if (!(backend.protocol === 'https:' || backend.protocol === 'http:' && loopback) ||
    backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('LEON_DESKTOP_SERVER must be an HTTPS origin or loopback HTTP origin')
  }
  const token = randomUUID()
  const files = createFileStore()
  let documentFrontend: { root: string, phase: string | undefined } | undefined

  function cancellation(request: IncomingMessage, response: ServerResponse): { signal: AbortSignal, dispose: () => void } {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    request.once('aborted', abort)
    response.once('close', abort)

    return { signal: controller.signal, dispose(): void {
      request.off('aborted', abort)
      response.off('close', abort)
    } }
  }

  async function proxy(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const target = new URL(backend)
    target.pathname = url.pathname
    target.search = url.search
    const headers: Record<string, string | string[]> = {}
    for (const name of REQUEST_HEADERS) {
      if (request.headers[name] !== undefined) {
        headers[name] = request.headers[name]
      }
    }
    if (request.method === 'POST' && OWNER_TURN_PATH.test(url.pathname)) {
      // Core may be remote, so label the turn using the native client's platform.
      headers[TURN_CLIENT_TYPE_HEADER] = TurnClientType.Desktop
      headers[TURN_CLIENT_OS_HEADER] = CLIENT_OS_BY_PLATFORM[process.platform] ?? TurnClientOS.Other
    }
    if (request.headers.origin) {
      headers['origin'] = backend.origin
    }
    const upload = request.method === 'POST' && url.pathname.endsWith('/attachments')
    let body: Readable = request
    if (request.method === 'POST' && url.pathname === '/api/v1/updates/apply') {
      const bytes = await readBody(request, 4_096)
      const input = JSON.parse(bytes.toString())
      if (typeof input.tag !== 'string') {
        throw Object.assign(new Error('Invalid Core update release'), { status: 400 })
      }
      try {
        await assertCoreUpdateCompatibility(input.tag)
      } catch (error) {
        throw Object.assign(new Error(error instanceof Error ? error.message : 'I could not verify Core compatibility.'), { status: 409 })
      }
      body = Readable.from([bytes])
    }
    const format = contract.formats.find((item) => item.mediaType === url.searchParams.get('media_type'))
    const maximumBytes = upload ? format?.maximumBytes ?? contract.maximumBytes : MAXIMUM_REQUEST_BYTES
    if (Number(request.headers['content-length']) > maximumBytes) {
      throw Object.assign(new Error('This file exceeds its attachment size limit.'), { status: 413 })
    }
    const active = cancellation(request, response)
    const upstream = requestBackend({ session: backendSession!, url: target,
      method: request.method ?? 'GET', headers, maximumBytes, signal: active.signal,
      ...(!['GET', 'HEAD'].includes(request.method ?? 'GET') ? { body } : {}) })
    try {
      const incoming = await upstream.response
      response.statusCode = incoming.statusCode
      for (const name of RESPONSE_HEADERS) {
        if (incoming.headers[name] !== undefined) {
          const value = incoming.headers[name]
          if (name === 'location') {
            const redirect = new URL(Array.isArray(value) ? value[0]! : value!, backend)
            response.setHeader(name, redirect.origin === backend.origin ? redirect.pathname + redirect.search + redirect.hash : value)
          } else {
            response.setHeader(name, value)
          }
        }
      }
      response.setHeader('x-content-type-options', 'nosniff')
      response.flushHeaders()
      await pipeline(incoming, response, { signal: active.signal })
    } finally {
      upstream.abort()
      active.dispose()
    }
  }

  async function nativeFile(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const segments = url.pathname.slice(contract.filesPath.length).split('/')
    const id = segments[0]
    if (!id || segments.length > 2) {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'DELETE' && segments.length === 1) {
      files.remove(id)
      response.writeHead(204).end()
      return
    }
    if (request.method === 'POST' && segments[1] === 'upload') {
      const input = JSON.parse((await readBody(request, 65_536)).toString())
      if (typeof input.sessionId !== 'string' || typeof input.profile !== 'string' ||
        input.uploadId !== id) {
        throw Object.assign(new Error('Invalid upload context'), { status: 400 })
      }
      const cookies = await backendSession!.cookies.get({ url: backend.href })
      const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ')
      const authRequest = requestBackend({ session: backendSession!,
        url: new URL('/api/v1/profile-auth', backend), cookie })
      const auth = await readBackendJSON(await authRequest.response)
      if (!auth['authenticated'] || auth['profile_name'] !== input.profile) {
        throw Object.assign(new Error('This attachment belongs to another profile.'), { status: 409 })
      }
      const file = await files.open(id)
      const active = cancellation(request, response)
      const target = new URL(`/api/v1/sessions/${encodeURIComponent(input.sessionId)}/attachments`, backend)
      target.search = new URLSearchParams({ filename: file.name, media_type: file.mediaType, upload_id: id }).toString()
      response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff' })
      response.flushHeaders()
      let nextProgress = 0
      let blocked = false
      response.on('drain', () => {
 blocked = false 
})
      const upstream = requestBackend({ session: backendSession!, url: target, method: 'POST', cookie,
        body: file.stream(), maximumBytes: file.size, signal: active.signal,
        headers: { 'content-type': 'application/octet-stream', origin: backend.origin },
        onProgress(loaded) {
          if (!blocked && (loaded === file.size || Date.now() >= nextProgress)) {
            nextProgress = Date.now() + 100
            blocked = !response.write(JSON.stringify({ type: 'progress', loaded }) + '\n')
          }
        } })
      try {
        const incoming = await upstream.response
        const result = await readBackendJSON(incoming)
        if (incoming.statusCode < 200 || incoming.statusCode >= 300 || !result['attachment']) {
          throw new Error(typeof result['message'] === 'string' ? result['message'] : 'I could not upload this file.')
        }
        await upstream.finished
        if (blocked) {
          await once(response, 'drain', { signal: active.signal })
        }
        response.end(JSON.stringify({ type: 'complete', attachment: result['attachment'] }) + '\n')
      } catch (error) {
        if (!response.destroyed) {
          response.end(JSON.stringify({ type: 'error', message: (error instanceof Error ? error.message : String(error)) }) + '\n')
        }
      } finally {
        upstream.abort()
        active.dispose()
      }
      return
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET') || segments.length !== 1) {
      response.writeHead(405).end()
      return
    }
    const file = await files.open(id)
    let start = 0
    let end = file.size - 1
    const range = request.headers.range
    if (range !== undefined) {
      const parts = range.startsWith('bytes=') ? range.slice(6).split('-') : []
      const numeric = (value: string): boolean => value !== '' && [...value].every((character) => character >= '0' && character <= '9')
      const [first = '', last = ''] = parts
      if (parts.length !== 2 || first && !numeric(first) || last && !numeric(last) || !first && !last) {
        await file.handle.close()
        response.writeHead(416, { 'content-range': `bytes */${file.size}` }).end()
        return
      }
      start = first ? Number(first) : Math.max(0, file.size - Number(last))
      end = first && last ? Math.min(Number(last), file.size - 1) : file.size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
        await file.handle.close()
        response.writeHead(416, { 'content-range': `bytes */${file.size}` }).end()
        return
      }
    }
    response.writeHead(range ? 206 : 200, { 'content-type': file.mediaType,
      'content-length': end - start + 1, 'accept-ranges': 'bytes',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${file.size}` } : {}),
      'cache-control': 'no-store',
      'content-security-policy': 'sandbox; default-src \'none\'', 'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}` })
    if (request.method === 'HEAD') {
      await file.handle.close()
      response.end()
    } else {
      await pipeline(file.stream({ start, end }), response)
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.host !== origin.slice('http://'.length) ||
      request.headers.origin && request.headers.origin !== origin) {
      response.writeHead(403).end()
      return
    }
    const url = new URL(request.url ?? '/', origin)
    if (request.method === 'GET' && url.pathname === `/__desktop/${token}`) {
      response.writeHead(303, { location: '/web-app/',
        'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
        'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
      return
    }
    if (!request.headers.cookie?.split(';').some((value) => value.trim() === `${SESSION_COOKIE}=${token}`)) {
      response.writeHead(401).end()
      return
    }
    if (reportPath && request.method === 'POST' && url.pathname === '/__desktop/test/paste') {
      await onDiagnosticPaste?.()
      response.writeHead(204).end()
      return
    }
    if (reportPath && onDiagnosticWindow && request.method === 'POST' && url.pathname === '/__desktop/test/window') {
      const { action } = JSON.parse((await readBody(request, 4_096)).toString())
      if (!['status', 'close', 'activate', 'quit', 'resize', 'hide', 'hide-popup'].includes(action)) {
        throw Object.assign(new Error('Invalid diagnostic window action'), { status: 400 })
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(onDiagnosticWindow(action)))
      return
    }
    if (reportPath && request.method === 'POST' && url.pathname === '/__desktop/report') {
      const bytes = await readBody(request)
      JSON.parse(bytes.toString())
      const pending = `${reportPath}.pending`
      await writeFile(pending, bytes)
      await rename(pending, reportPath)
      response.writeHead(204).end()
      return
    }
    if (state && request.method === 'POST' && url.pathname === '/__desktop/preferences') {
      await state.update(JSON.parse((await readBody(request, 65_536)).toString()))
      response.writeHead(204).end()
      return
    }
    if (url.pathname.startsWith(contract.filesPath)) {
      await nativeFile(request, response, url)
      return
    }
    if (bootstrap && url.pathname.startsWith(DESKTOP_BOOTSTRAP_PATH)) {
      await bootstrap(request, response, url, readBody)
      return
    }
    if (desktopUpdates && url.pathname.startsWith(contract.updatesPath)) {
      await desktopUpdates(request, response, url, readBody)
      return
    }
    if (notifications && url.pathname === DESKTOP_NOTIFICATION_PATH) {
      await notifications(request, response, url, readBody)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (!backendOrigin || bootstrapPhase && bootstrapPhase() !== 'complete') {
        response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ message: 'I’m preparing my Core. Please wait for it to be ready.' }))
        return
      }
      await proxy(request, response, url)
      return
    }
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      response.writeHead(405).end()
      return
    }
    if (!url.pathname.startsWith('/web-app/')) {
      response.writeHead(404).end()
      return
    }
    const relative = decodeURIComponent(url.pathname.slice('/web-app/'.length))
    const acceptsHTML = request.headers.accept?.includes('text/html')
    const destination = request.headers['sec-fetch-dest']
    const navigation = request.method === 'GET' && (
      destination === 'document' ||
      (destination === undefined && (!relative || relative === FRONTEND_INDEX || acceptsHTML))
    )

    // Keep serving the current page's assets until it navigates to the ready frontend.
    const selected = !navigation && documentFrontend ? documentFrontend : {
      phase: bootstrapPhase?.(),
      root: typeof frontend === 'function' ? path.resolve(await frontend()) : frontend
    }
    const frontendRoot = selected.root
    let file = path.resolve(frontendRoot, relative || FRONTEND_INDEX)
    if (!file.startsWith(`${frontendRoot}${path.sep}`)) {
      response.writeHead(403).end()
      return
    }
    let info = await stat(file).catch(() => null)
    if (!info?.isFile() && acceptsHTML) {
      file = path.join(frontendRoot, FRONTEND_INDEX)
      info = await stat(file)
    }
    if (!info?.isFile()) {
      response.writeHead(404).end()
      return
    }
    if (path.basename(file) === FRONTEND_INDEX) {
      const nonce = randomUUID()
      const policy = CONTENT_SECURITY_POLICY.replace('script-src ', `script-src 'nonce-${nonce}' `)
      const html = (await readFile(file, 'utf8')).replaceAll('<script ', `<script nonce="${nonce}" `)
        .replace('<head>', '<head>' + (state?.bootstrap(nonce) ?? '<meta name="leon-desktop" content="true">') +
        (desktopUpdates ? `<meta name="${contract.updatesMetaName}" content="true">` : '') +
        (selected.phase !== undefined ? `<meta name="${DESKTOP_BOOTSTRAP_META_NAME}" content="${selected.phase === 'complete' ? 'complete' : 'pending'}">` : ''))
      if (navigation && !response.destroyed) {
        documentFrontend = selected
      }
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store',
        'content-security-policy': policy, 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer' }).end(request.method === 'HEAD' ? undefined : html)
      return
    }
    response.writeHead(200, { 'content-type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': info.size, 'cache-control': 'no-store',
      'content-security-policy': CONTENT_SECURITY_POLICY,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    await pipeline(createReadStream(file), response)
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead((error as HostError).status ?? 502, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ message: (error as HostError).status ? (error instanceof Error ? error.message : String(error)) : 'I could not complete the desktop request.' }))
      } else {
        response.destroy()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  return { origin, grantFiles: (paths) => files.grant(paths), entry: `${origin}/__desktop/${token}`, close(): void {
    server.closeAllConnections()
    server.close()
  } }
}
