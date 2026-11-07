import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { faviconsPlugin } from '@/core/http-server/api/favicons'

const fixture = vi.hoisted(() => ({
  addresses: [{ address: '93.184.215.14', family: 4 }],
  hostAddresses: new Map<string, Array<{ address: string, family: number }>>(),
  connections: 0,
  hold: false,
  finishes: [] as Array<() => void>,
  status: 200,
  type: 'image/png',
  bytes: Buffer.from('small fixture image'),
  target: {} as Record<string, unknown>,
  targets: [] as Array<Record<string, unknown>>,
  routes: new Map<string, { status: number, type: string, bytes: Buffer, headers?: Record<string, string> }>()
}))

vi.mock('node:dns', () => ({
  lookup: (host: string, _options: unknown, callback: (error: Error | null, addresses: typeof fixture.addresses) => void): void => {
    callback(null, fixture.hostAddresses.get(host) ?? fixture.addresses)
  }
}))

vi.mock('node:https', () => ({
  request: (options: Record<string, unknown>, receive: (response: EventEmitter & { statusCode: number, headers: Record<string, string> }) => void): EventEmitter & { end: () => void, destroy: () => void } => {
    fixture.target = options
    fixture.targets.push(options)
    const pending = new EventEmitter() as EventEmitter & { end: () => void, destroy: () => void }
    pending.destroy = (): void => { pending.emit('close') }
    const signal = options['signal'] as AbortSignal
    const abort = (): void => pending.destroy()
    signal.addEventListener('abort', abort, { once: true })
    pending.on('close', () => signal.removeEventListener('abort', abort))
    pending.end = (): void => {
      queueMicrotask(() => {
        const lookup = options['lookup'] as (host: string, options: { all: boolean }, callback: (error: Error | null) => void) => void
        lookup(String(options['hostname']), { all: true }, (error) => {
          if (error) {
            pending.emit('error', error)
            pending.emit('close')
            return
          }

          fixture.connections++
          const finish = (): void => {
            const route = fixture.routes.get(`${options['hostname']}${options['path']}`)
            const response = Object.assign(new PassThrough(), {
              statusCode: route?.status ?? fixture.status,
              headers: { 'content-type': route?.type ?? fixture.type, ...route?.headers }
            })
            response.on('end', () => pending.emit('close'))
            receive(response)
            response.end(route?.bytes ?? fixture.bytes)
          }
          if (fixture.hold) {
            fixture.finishes.push(finish)
          } else {
            finish()
          }
        })
      })
    }

    return pending
  }
}))

describe('public-site favicon API', () => {
  let app = Fastify()
  const get = (origin: string): ReturnType<typeof app.inject> => app.inject({ url: `/api/v1/favicons?origin=${encodeURIComponent(origin)}` })

  beforeEach(async () => {
    fixture.addresses = [{ address: '93.184.215.14', family: 4 }]
    fixture.hostAddresses = new Map()
    fixture.connections = 0
    fixture.hold = false
    fixture.finishes = []
    fixture.status = 200
    fixture.type = 'image/png'
    fixture.bytes = Buffer.from('small fixture image')
    fixture.targets = []
    fixture.routes = new Map()
    app = Fastify()
    await app.register(faviconsPlugin, { apiVersion: 'v1' })
  })

  afterEach(async () => {
    await app.close()
  })

  it('coalesces and caches fixed-path HTTPS icon loads without forwarding owner data', async () => {
    const responses = await Promise.all([get('https://example.com'), get('https://example.com')])
    const cached = await get('https://example.com')
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
    expect(cached.rawPayload).toEqual(fixture.bytes)
    expect(cached.headers['content-type']).toBe('image/png')
    expect(cached.headers['cache-control']).toBe('private, max-age=86400')
    expect(cached.headers['x-content-type-options']).toBe('nosniff')
    expect(fixture.connections).toBe(1)
    expect(fixture.target).toMatchObject({ hostname: 'example.com', path: '/favicon.ico', port: 443 })
    expect(Object.keys(fixture.target['headers'] as object)).toEqual(['Accept', 'Accept-Encoding', 'User-Agent'])
    expect(fixture.target['headers']).toMatchObject({ 'User-Agent': 'LeonAI (+https://getleon.ai)' })
  })

  it('queues bursts without exceeding eight simultaneous external loads', async () => {
    fixture.hold = true
    const requests = Array.from({ length: 12 }, (_, index) => get(`https://site${index}.example`).then((response) => response))
    await vi.waitFor(() => expect(fixture.connections).toBe(8))
    expect(fixture.finishes).toHaveLength(8)
    fixture.finishes.splice(0).forEach((finish) => finish())
    await vi.waitFor(() => expect(fixture.connections).toBe(12))
    fixture.finishes.splice(0).forEach((finish) => finish())

    expect((await Promise.all(requests)).map((response) => response.statusCode)).toEqual(Array(12).fill(200))
  })

  it('retains recently used hosts and writes coalesced results to the cache once', async () => {
    for (let index = 0; index < 128; index++) {
      await get(`https://site${index}.example`)
    }
    await get('https://site0.example')
    await Promise.all(Array.from({ length: 16 }, () => get('https://new.example')))
    const before = fixture.connections
    await get('https://site0.example')
    await get('https://site2.example')
    expect(fixture.connections).toBe(before)
    await get('https://site1.example')
    expect(fixture.connections).toBe(before + 1)
  })

  it.each([
    'https://127.0.0.1', 'http://2130706433', 'https://[::1]', 'https://[::ffff:127.0.0.1]',
    'https://10.0.0.1', 'https://169.254.169.254', 'https://[fd00::1]'
  ])('never connects to private or alternative-notation addresses: %s', async (origin) => {
    expect((await get(origin)).statusCode).toBe(404)
    expect(fixture.connections).toBe(0)
  })

  it('rejects a hostname when any DNS answer is private and caches the failure', async () => {
    fixture.addresses.push({ address: '127.0.0.1', family: 4 })
    expect((await get('https://example.com')).statusCode).toBe(404)
    fixture.addresses = [{ address: '93.184.215.14', family: 4 }]
    expect((await get('https://example.com')).statusCode).toBe(404)
    expect(fixture.connections).toBe(0)
  })

  it.each(['file:///etc/passwd', 'https://owner:secret@example.com', 'https://example.com:8443', 'https://example.com/private?secret=true'])(
    'rejects non-origin inputs and custom ports: %s', async (origin) => {
      expect((await get(origin)).statusCode).toBe(400)
      expect(fixture.connections).toBe(0)
    }
  )

  it.each(['redirect without location', 'svg', 'oversized'])('rejects %s responses instead of trusting external content', async (kind) => {
    if (kind === 'redirect without location') {
      fixture.status = 302
    } else if (kind === 'svg') {
      fixture.type = 'image/svg+xml'
    } else {
      fixture.bytes = Buffer.alloc(65_537)
    }

    expect((await get('https://example.com')).statusCode).toBe(404)
    expect(fixture.connections).toBe(2)
  })

  it('coalesces HTML discovery for missing icons and resolves a redirected CDN icon', async () => {
    fixture.routes.set('example.com/favicon.ico', { status: 404, type: 'text/html', bytes: Buffer.from('Missing') })
    fixture.routes.set('example.com/', { status: 200, type: 'text/html', bytes: Buffer.from(
      '<title>Ordinary title</title><meta property="og:title" content="A useful guide"><meta property="og:site_name" content="Warm craft"><meta name="twitter:description" content="One good idea."><link rel="icon" href="https://cdn.example/icon">'
    ) })
    fixture.routes.set('cdn.example/icon', {
      status: 302, type: 'text/html', bytes: Buffer.alloc(0), headers: { location: '/small.png?signature=keep-me' }
    })
    const [icon, repeated] = await Promise.all([
      get('https://example.com'), get('https://example.com')
    ])
    expect(icon.statusCode).toBe(200)
    expect(repeated.rawPayload).toEqual(icon.rawPayload)
    expect(fixture.targets.filter((target) => target['hostname'] === 'example.com' && target['path'] === '/')).toHaveLength(1)
    expect(fixture.targets.at(-1)).toMatchObject({ hostname: 'cdn.example', path: '/small.png?signature=keep-me' })
    expect(fixture.targets.every((target) => Object.keys(target['headers'] as object).length === 3)).toBe(true)
  })

  it.each([
    ['<LINK REL="shortcut\tICON" HREF="icons/small.png?a=1&amp;b=2">', '/guide/icons/small.png?a=1&b=2'],
    ['<link rel="icon" href="small.png"><base href="../assets/">', '/assets/small.png'],
    ['<link rel="apple-touch-icon" href="../touch.png">', '/touch.png'],
    ['<link rel="apple-touch-icon-precomposed" href="//cdn.example/touch.png">', '/touch.png']
  ])('resolves declared icons against redirected pages and their base URL: %s', async (html, expectedPath) => {
    fixture.routes.set('example.com/favicon.ico', { status: 404, type: 'text/html', bytes: Buffer.from('Missing') })
    fixture.routes.set('example.com/', {
      status: 302, type: 'text/html', bytes: Buffer.alloc(0), headers: { location: '/guide/' }
    })
    fixture.routes.set('example.com/guide/', { status: 200, type: 'text/html', bytes: Buffer.from(html) })

    expect((await get('https://example.com')).statusCode).toBe(200)
    expect(fixture.target['path']).toBe(expectedPath)
    expect(fixture.target['hostname']).toBe(html.includes('cdn.example') ? 'cdn.example' : 'example.com')
  })

  it('prioritizes regular icons, deduplicates resolved URLs and bounds candidate loads', async () => {
    fixture.status = 404
    fixture.routes.set('example.com/', { status: 200, type: 'text/html', bytes: Buffer.from(
      '<link rel="apple-touch-icon" href="/touch.png">' +
      '<link rel="icon" href="/one.png"><link rel="shortcut icon" href="https://example.com/one.png">' +
      '<link rel="icon" href="/two.png"><link rel="icon" href="/three.png"><link rel="icon" href="/four.png">'
    ) })

    expect((await get('https://example.com')).statusCode).toBe(404)
    expect(fixture.targets.map((target) => target['path']))
      .toEqual(['/favicon.ico', '/', '/one.png', '/two.png', '/three.png'])
  })

  it('ignores inert template, comment and script markup while finding a usable icon', async () => {
    fixture.routes.set('example.com/favicon.ico', { status: 404, type: 'text/html', bytes: Buffer.from('Missing') })
    fixture.routes.set('example.com/', { status: 200, type: 'text/html', bytes: Buffer.from(
      '<template><link rel="icon" href="/template.png"></template>' +
      '<!-- <link rel="icon" href="/comment.png"> -->' +
      '<script>const icon = \'<link rel="icon" href="/script.png">\';</script>' +
      '<link rel="icon" href="/real.png">'
    ) })

    expect((await get('https://example.com')).statusCode).toBe(200)
    expect(fixture.target['path']).toBe('/real.png')
    expect(fixture.connections).toBe(3)
  })

  it.each(['https://127.0.0.1/icon', 'https://private.example/icon', 'https://cdn.example:8443/icon', 'file:///etc/passwd'])(
    'keeps discovered HTML icon destinations behind the public-site transport: %s', async (href) => {
      fixture.routes.set('example.com/favicon.ico', { status: 404, type: 'text/html', bytes: Buffer.from('Missing') })
      fixture.routes.set('example.com/', {
        status: 200, type: 'text/html', bytes: Buffer.from(`<link rel="icon" href="${href}">`)
      })
      fixture.hostAddresses.set('private.example', [{ address: '10.0.0.1', family: 4 }])

      expect((await get('https://example.com')).statusCode).toBe(404)
      expect(fixture.connections).toBe(2)
    }
  )

  it.each(['https://127.0.0.1/icon', 'https://cdn.example:8443/icon', 'http://cdn.example/icon', 'file:///etc/passwd'])(
    'never follows an unsafe or downgraded redirect: %s', async (location) => {
      fixture.routes.set('example.com/favicon.ico', {
        status: 302, type: 'text/html', bytes: Buffer.alloc(0), headers: { location }
      })
      expect((await get('https://example.com')).statusCode).toBe(404)
      expect(fixture.targets.every((target) => target['hostname'] === 'example.com')).toBe(true)
    }
  )

  it('bounds redirect loops before falling back to page discovery', async () => {
    fixture.routes.set('example.com/favicon.ico', {
      status: 302, type: 'text/html', bytes: Buffer.alloc(0), headers: { location: '/favicon.ico' }
    })
    expect((await get('https://example.com')).statusCode).toBe(404)
    expect(fixture.connections).toBe(5)
  })

  it('rejects private DNS answers on redirected icon hosts', async () => {
    fixture.routes.set('example.com/favicon.ico', {
      status: 302, type: 'text/html', bytes: Buffer.alloc(0), headers: { location: 'https://cdn.example/icon' }
    })
    fixture.hostAddresses.set('cdn.example', [{ address: '10.0.0.1', family: 4 }])
    expect((await get('https://example.com')).statusCode).toBe(404)
    expect(fixture.connections).toBe(2)
  })

  it('discovers icons from bounded decompressed HTML without serving page markup or preview metadata', async () => {
    const html = `<head><link rel="icon" href="/small.png"><meta name="description" content="${'a'.repeat(1_000)}"></head>${'b'.repeat(200_000)}`
    fixture.routes.set('example.com/favicon.ico', { status: 404, type: 'text/html', bytes: Buffer.from('Missing') })
    fixture.routes.set('example.com/', {
      status: 200, type: 'text/html; charset=utf-8', bytes: gzipSync(html), headers: { 'content-encoding': 'gzip' }
    })
    const icon = await get('https://example.com')
    expect(icon.statusCode).toBe(200)
    expect(icon.rawPayload).toEqual(fixture.bytes)
    expect(fixture.target['path']).toBe('/small.png')
    expect((await get('https://example.com')).rawPayload).toEqual(icon.rawPayload)
    expect(fixture.connections).toBe(3)
    expect((await app.inject('/api/v1/link-preview?url=https%3A%2F%2Fexample.com')).statusCode).toBe(404)
  })

  it('cancels active and queued requests when the server closes', async () => {
    fixture.hold = true
    const requests = Array.from({ length: 12 }, (_, index) => get(`https://site${index}.example`).then((response) => response))
    await vi.waitFor(() => expect(fixture.connections).toBe(8))
    await app.close()
    expect((await Promise.all(requests)).every((response) => response.statusCode === 404)).toBe(true)
    expect(fixture.connections).toBe(8)
  })
})
