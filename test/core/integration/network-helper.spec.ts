import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { NetworkHelper } from '@/helpers/network-helper'
import * as DownloadSources from '@@/bridges/runtime/nodejs/download-sources.js'
import {
  CHINA_NPM_REGISTRY,
  CHINA_PYPI_INDEX,
  configureRegionalPnpm,
  getDownloadRegion,
  getRegionalInstallerEnvironment
} from '@@/bridges/runtime/nodejs/download-region.js'

describe('NetworkHelper download integration', () => {
  const temporaryPaths: string[] = []
  const servers: http.Server[] = []

  afterEach(async () => {
    vi.restoreAllMocks()

    await Promise.all(servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }))

    for (const temporaryPath of temporaryPaths.splice(0)) {
      fs.rmSync(temporaryPath, { recursive: true, force: true })
    }
  })

  it.each(['CN', 'US', 'unavailable'])(
    'caches network-country decisions and retains original sources when country is %s',
    async (country) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-network-country-'))
      temporaryPaths.push(directory)
      const environment = { LEON_DOWNLOAD_REGION: 'auto', XDG_CACHE_HOME: directory }
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        if (country === 'unavailable') {
          await new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
          })
        }

        return new Response(country)
      })

      const region = country === 'CN' ? 'cn' : 'global'
      expect(await getDownloadRegion(environment)).toBe(region)
      expect(await getDownloadRegion(environment)).toBe(region)
      expect(fetch).toHaveBeenCalledTimes(1)
      const cached = JSON.parse(fs.readFileSync(path.join(directory, 'leon', 'downloads', 'region.json'), 'utf8'))
      expect(cached.region).toBe(region)
      expect(await getDownloadRegion({ ...environment, LEON_DOWNLOAD_REGION: 'global' })).toBe('global')
      expect(await getDownloadRegion({ ...environment, LEON_DOWNLOAD_REGION: 'cn' })).toBe('cn')
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('preserves private registry scopes, credentials and explicit installer hosts in China', async () => {
    vi.stubEnv('LEON_DOWNLOAD_REGION', 'cn')
    vi.stubEnv('npm_config_registry', '')
    vi.stubEnv('NPM_CONFIG_REGISTRY', '')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))
    const config = {
      registriesByScope: { default: 'https://registry.npmjs.org/', '@private': 'https://private.example/' },
      configByUri: { '//private.example/': { _authToken: 'private-token' } },
      minimumReleaseAge: 2_160,
      minimumReleaseAgeStrict: true,
      extraEnv: { PLAYWRIGHT_DOWNLOAD_HOST: 'https://browsers.example/' }
    }
    const result = await configureRegionalPnpm(config)

    expect(result.registriesByScope).toEqual({
      default: CHINA_NPM_REGISTRY, '@private': 'https://private.example/'
    })
    expect(result.configByUri).toEqual(config.configByUri)
    expect(result.minimumReleaseAge).toBe(2_160)
    expect(result.minimumReleaseAgeStrict).toBe(true)
    expect(result.extraEnv.PLAYWRIGHT_DOWNLOAD_HOST).toBe('https://browsers.example/')
    const privateConfig = { ...config, registriesByScope: { default: 'https://private.example/' } }
    expect((await configureRegionalPnpm(privateConfig)).registriesByScope).toEqual(privateConfig.registriesByScope)

    const environment = await getRegionalInstallerEnvironment({ LEON_DOWNLOAD_REGION: 'cn' })
    expect(environment.UV_DEFAULT_INDEX).toBe(CHINA_PYPI_INDEX)
    const explicit = {
      LEON_DOWNLOAD_REGION: 'cn', UV_INDEX_URL: 'https://python.example/simple/',
      HTTPS_PROXY: 'http://proxy.example:8080'
    }
    const preserved = await getRegionalInstallerEnvironment(explicit)
    expect(preserved.UV_DEFAULT_INDEX).toBeUndefined()
    expect(preserved.UV_INDEX_URL).toBe(explicit.UV_INDEX_URL)
    expect(preserved.HTTPS_PROXY).toBe(explicit.HTTPS_PROXY)
  })

  it('leaves signed, authenticated and unlisted release sources untouched', async () => {
    vi.stubEnv('LEON_DOWNLOAD_REGION', 'cn')
    const fetch = vi.spyOn(globalThis, 'fetch')

    for (const url of [
      'https://nodejs.org/dist/v1/archive.tar.gz?token=private',
      'https://user:secret@nodejs.org/dist/v1/archive.tar.gz',
      'https://github.com/private/project/releases/download/v1/archive.tar.gz',
      'https://nodejs.org.attacker.example/dist/archive.tar.gz'
    ]) {
      expect(await DownloadSources.getDownloadSources(url)).toEqual([{ url }])
    }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires trusted upstream release or public model metadata before selecting artifact mirrors', async () => {
    vi.stubEnv('LEON_DOWNLOAD_REGION', 'cn')
    vi.stubEnv('HF_ENDPOINT', '')
    vi.stubEnv('HF_TOKEN', '')
    vi.stubEnv('HUGGING_FACE_HUB_TOKEN', '')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-upstream-digests-'))
    temporaryPaths.push(directory)
    vi.stubEnv('XDG_CACHE_HOME', directory)
    const releaseURL = 'https://github.com/pnpm/pnpm/releases/download/v1.2.3/asset+build.tar.gz'
    const modelURL = 'https://huggingface.co/public/weights/resolve/revision/weights.gguf'
    const digest = createHash('sha256').update('upstream artifact').digest('hex')
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
      String(url).startsWith('https://api.github.com/')
        ? { assets: [{ browser_download_url: releaseURL.replace('+', '%2B'), digest: `sha256:${digest}` }] }
        : { private: false, siblings: [{ rfilename: 'weights.gguf', lfs: { sha256: digest } }] }
    )))

    expect(await DownloadSources.getDownloadSources(releaseURL)).toEqual([
      { url: `https://gh-proxy.com/${releaseURL}`, sha256: digest },
      { url: releaseURL, sha256: digest }
    ])
    expect(await DownloadSources.getDownloadSources(modelURL)).toEqual([
      { url: modelURL.replace('https://huggingface.co', 'https://hf-mirror.com'), sha256: digest },
      { url: modelURL, sha256: digest }
    ])
    fetch.mockResolvedValue(new Response(null, { status: 503 }))
    const unavailable = 'https://github.com/pnpm/pnpm/releases/download/v2.3.4/missing.tar.gz'
    expect(await DownloadSources.getDownloadSources(unavailable)).toEqual([{ url: unavailable }])
    fetch.mockResolvedValue(new Response(JSON.stringify({ private: true, siblings: [] })))
    const privateModel = 'https://huggingface.co/private/weights/resolve/revision/weights.gguf'
    expect(await DownloadSources.getDownloadSources(privateModel)).toEqual([{ url: privateModel }])
  })

  it('cancels downloads while regional source discovery is pending without starting a transfer', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-download-discovery-'))
    temporaryPaths.push(directory)
    const discovery = Promise.withResolvers<Array<{ url: string }>>()
    const entered = Promise.withResolvers<void>()
    const sources = vi.spyOn(DownloadSources, 'getDownloadSources').mockImplementation(async () => {
      entered.resolve()
      return discovery.promise
    })
    const pending = NetworkHelper.downloadFile('https://nodejs.org/dist/asset', path.join(directory, 'asset'))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    expect(NetworkHelper.abortActiveDownloads()).toBe(1)
    discovery.resolve([{ url: 'http://127.0.0.1:1/never-requested' }])
    await rejected
    expect(fs.readdirSync(directory)).toEqual([])
    sources.mockRestore()
  })

  it('verifies mirror bytes before publication and restarts from the origin after a corrupt mirror', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-verified-download-'))
    temporaryPaths.push(directory)
    const destination = path.join(directory, 'asset')
    const content = Buffer.from('trusted upstream artifact')
    const checksum = createHash('sha256').update(content).digest('hex')
    const originalRanges: Array<string | undefined> = []
    const mirror = await listen(http.createServer((request, response) => {
      const body = Buffer.from('untrusted mirror contents')
      response.writeHead(200, { 'content-length': body.length })
      response.end(body)
    }))
    const original = await listen(http.createServer((request, response) => {
      originalRanges.push(request.headers.range)
      response.writeHead(200, { 'content-length': content.length })
      response.end(content)
    }))
    const sources = vi.spyOn(DownloadSources, 'getDownloadSources').mockResolvedValue([
      { url: mirror, sha256: checksum }, { url: original, sha256: checksum }
    ])
    vi.spyOn(LogHelper, 'warning').mockImplementation(() => {})

    await NetworkHelper.downloadFile('https://github.com/example/release', destination, {
      cliProgress: false, retry: { retries: 0 }, retryFetchDownloadInfo: { retries: 0 }
    })

    expect(fs.readFileSync(destination)).toEqual(content)
    expect(originalRanges.every((range) => !range || range === 'bytes=0-0')).toBe(true)
    expect(fs.readdirSync(directory)).toEqual(['asset'])
    sources.mockRestore()
    vi.stubEnv('LEON_DOWNLOAD_REGION', 'global')
    await expect(NetworkHelper.downloadFile(original, path.join(directory, 'rejected'), {
      sha256: createHash('sha256').update('different artifact').digest('hex'),
      cliProgress: false, retry: { retries: 0 }, retryFetchDownloadInfo: { retries: 0 }
    })).rejects.toThrow('SHA-256')
    expect(fs.readdirSync(directory)).toEqual(['asset'])
  })

  /**
   * Starts a local download endpoint with teardown for interrupted responses.
   */
  async function listen(server: http.Server): Promise<string> {
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start the download endpoint.')
    }

    return `http://127.0.0.1:${address.port}`
  }

  it.each([301, 302, 303, 307, 308])(
    'resumes through relative and cross-origin redirects with HTTP %i when HEAD is unavailable',
    async (status) => {
      const content = Buffer.from('downloaded file contents')
      const prefixBytes = 5
      const requests: Array<{ method?: string, range?: string, encoding?: string }> = []
      const targetURL = await listen(http.createServer((request, response) => {
        requests.push({
          method: request.method,
          range: request.headers.range,
          encoding: request.headers['accept-encoding']
        })

        if (request.method === 'HEAD') {
          response.writeHead(405)
          response.end()
          return
        }

        const [start, end] = request.headers.range!.slice('bytes='.length).split('-')
        const startOffset = Number(start)
        const endOffset = end ? Number(end) : content.length - 1
        const body = content.subarray(startOffset, endOffset + 1)
        response.writeHead(206, {
          'content-length': body.length,
          'content-range': `bytes ${startOffset}-${endOffset}/${content.length}`
        })
        response.end(body)
      }))
      const sourceURL = await listen(http.createServer((request, response) => {
        response.writeHead(status, {
          location: request.url === '/start' ? '/redirect' : `${targetURL}/file`
        })
        // Following a redirect must not wait for its body to finish.
        response.flushHeaders()
      }))
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-download-redirect-'))
      temporaryPaths.push(directory)
      const destination = path.join(directory, 'file')
      fs.writeFileSync(`${destination}.download`, content.subarray(0, prefixBytes))

      await NetworkHelper.downloadFile(`${sourceURL}/start`, destination, {
        cliProgress: false,
        retry: { retries: 0 },
        retryFetchDownloadInfo: { retries: 0 }
      })

      expect(fs.readFileSync(destination)).toEqual(content)
      expect(requests).toEqual([
        { method: 'HEAD', range: undefined, encoding: 'identity' },
        { method: 'GET', range: 'bytes=0-0', encoding: 'identity' },
        { method: 'GET', range: `bytes=${prefixBytes}-`, encoding: 'identity' }
      ])
    }
  )

  it('rejects redirect loops without publishing a destination file', async () => {
    const url = await listen(http.createServer((_request, response) => {
      response.writeHead(302, { location: '/loop' })
      response.flushHeaders()
    }))
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-download-loop-'))
    temporaryPaths.push(directory)
    const destination = path.join(directory, 'file')

    await expect(NetworkHelper.downloadFile(`${url}/loop`, destination, {
      cliProgress: false,
      retry: { retries: 0 },
      retryFetchDownloadInfo: { retries: 0 }
    })).rejects.toThrow('Too many redirects')
    expect(fs.existsSync(destination)).toBe(false)
  })

  it.each(['headers', 'body'])(
    'cancels a download while waiting for its %s and closes the connection',
    async (phase) => {
      const controller = new AbortController()
      let requestClosed: Promise<void> | undefined
      const url = await listen(http.createServer((request, response) => {
        if (request.method === 'HEAD') {
          response.writeHead(200, {
            'accept-ranges': 'bytes',
            'content-length': 100
          })
          response.end()
          return
        }

        requestClosed = new Promise<void>((resolve) => {
          response.once('close', resolve)
        })

        if (phase === 'body') {
          response.writeHead(200, { 'content-length': 100 })
          response.write('partial')
        }

        setImmediate(() => {
          controller.abort()
        })
      }))
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-download-abort-'))
      temporaryPaths.push(directory)
      const destination = path.join(directory, 'file')

      await expect(NetworkHelper.downloadFile(url, destination, {
        cliProgress: false,
        signal: controller.signal,
        retry: { retries: 0 },
        retryFetchDownloadInfo: { retries: 0 }
      })).rejects.toMatchObject({ name: 'AbortError' })
      await requestClosed
      expect(fs.existsSync(destination)).toBe(false)
    }
  )

  it('resumes a sequential download after a transient connection failure', async () => {
    const content = Buffer.alloc(128 * 1_024, 'a')
    const interruptedAt = 32 * 1_024
    const rangeHeaders: string[] = []
    let getRequestCount = 0
    const server = http.createServer((request, response) => {
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'accept-ranges': 'bytes',
          'content-length': content.length
        })
        response.end()
        return
      }

      getRequestCount += 1
      const rangeHeader = request.headers.range

      if (rangeHeader) {
        rangeHeaders.push(rangeHeader)
        const startOffset = Number(rangeHeader.match(/^bytes=(\d+)-$/)?.[1])
        const remainingContent = content.subarray(startOffset)

        response.writeHead(206, {
          'content-length': remainingContent.length,
          'content-range': `bytes ${startOffset}-${content.length - 1}/${content.length}`
        })
        response.end(remainingContent)
        return
      }

      if (getRequestCount === 1) {
        response.writeHead(200, {
          'content-length': content.length
        })
        response.end(content.subarray(0, interruptedAt))
        return
      }

      response.writeHead(200, {
        'content-length': content.length
      })
      response.end(content)
    })
    // Allow partial bytes to flush without waiting for Node's multi-second default.
    server.keepAliveTimeout = 100
    server.keepAliveTimeoutBuffer = 0

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start the download test server.')
    }

    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'leon-network-helper-')
    )
    temporaryPaths.push(temporaryDirectory)
    const destinationPath = path.join(temporaryDirectory, 'model.gguf')
    const warningSpy = vi.spyOn(LogHelper, 'warning').mockImplementation(() => {})

    try {
      await NetworkHelper.downloadFile(
        `http://127.0.0.1:${address.port}/model.gguf`,
        destinationPath,
        {
          cliProgress: false,
          parallelStreams: 1,
          retry: {
            retries: 1,
            minTimeout: 1,
            maxTimeout: 1
          }
        }
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }

    expect(getRequestCount).toBe(2)
    expect(rangeHeaders).toEqual([`bytes=${interruptedAt}-`])
    expect(fs.readFileSync(destinationPath)).toEqual(content)
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining('Download attempt 1 failed; retrying:')
    )
  })

  it('retries only the stalled remainder of a parallel range', async () => {
    const totalBytes = 128 * 1_024 * 1_024 + 3
    const existingPrefixBytes = 1_024 * 1_024
    const partialBytes = 1_024 * 1_024
    const rangeRequests: Array<{ start: number, end: number }> = []
    let stalledRangeStart: number | null = null
    let stalledRangeEnd: number | null = null
    let stalledRequestCount = 0
    const server = http.createServer((request, response) => {
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'accept-ranges': 'bytes',
          'content-length': totalBytes
        })
        response.end()
        return
      }

      const rangeMatch = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/)
      if (!rangeMatch) {
        response.writeHead(400)
        response.end()
        return
      }

      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      rangeRequests.push({ start, end })
      const rangeLength = end - start + 1

      if (stalledRangeEnd === null && rangeRequests.length === 2) {
        stalledRangeStart = start
        stalledRangeEnd = end
      }

      if (end === stalledRangeEnd && stalledRequestCount < 3) {
        stalledRequestCount += 1
        response.writeHead(206, {
          'content-length': rangeLength,
          'content-range': `bytes ${start}-${end}/${totalBytes}`
        })
        if (stalledRequestCount > 1) {
          response.write(Buffer.alloc(partialBytes, 'b'))
        }
        return
      }

      response.writeHead(206, {
        'content-length': rangeLength,
        'content-range': `bytes ${start}-${end}/${totalBytes}`
      })

      const chunk = Buffer.alloc(1_024 * 1_024, 'b')
      let remainingBytes = rangeLength
      while (remainingBytes > 0) {
        const bytesToWrite = Math.min(remainingBytes, chunk.length)
        response.write(chunk.subarray(0, bytesToWrite))
        remainingBytes -= bytesToWrite
      }
      response.end()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start the parallel download test server.')
    }

    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'leon-network-helper-parallel-')
    )
    temporaryPaths.push(temporaryDirectory)
    const destinationPath = path.join(temporaryDirectory, 'model.gguf')
    fs.writeFileSync(
      `${destinationPath}.download`,
      Buffer.alloc(existingPrefixBytes, 'b')
    )
    const warningSpy = vi
      .spyOn(LogHelper, 'warning')
      .mockImplementation(() => {})

    const modelURL = `http://127.0.0.1:${address.port}/model.gguf`
    const downloadOptions = {
      cliProgress: false,
      inactivityTimeoutMs: 500,
      parallelStreams: 3,
      retry: {
        retries: 0,
        minTimeout: 1,
        maxTimeout: 1
      }
    }

    try {
      await expect(
        NetworkHelper.downloadFile(
          modelURL,
          destinationPath,
          downloadOptions
        )
      ).rejects.toThrow('Download stalled')
      expect(
        fs.existsSync(`${destinationPath}.download.state.json`)
      ).toBe(true)

      await NetworkHelper.downloadFile(modelURL, destinationPath, downloadOptions)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    expect(rangeRequests).toHaveLength(6)
    expect(Math.min(...rangeRequests.map(({ start }) => start))).toBe(
      existingPrefixBytes
    )
    expect(stalledRangeStart).not.toBeNull()
    expect(rangeRequests).toContainEqual(
      expect.objectContaining({
        start: (stalledRangeStart as number) + partialBytes
      })
    )
    expect(rangeRequests).toContainEqual(
      expect.objectContaining({
        start: (stalledRangeStart as number) + 2 * partialBytes
      })
    )
    expect(fs.statSync(destinationPath).size).toBe(totalBytes)
    expect(fs.existsSync(`${destinationPath}.download.state.json`)).toBe(false)
    expect(warningSpy).not.toHaveBeenCalled()

    const fileHandle = fs.openSync(destinationPath, 'r')
    const sample = Buffer.alloc(3)
    fs.readSync(fileHandle, sample, 0, 1, 0)
    fs.readSync(fileHandle, sample, 1, 1, Math.floor(totalBytes / 2))
    fs.readSync(fileHandle, sample, 2, 1, totalBytes - 1)
    fs.closeSync(fileHandle)
    expect(sample).toEqual(Buffer.from('bbb'))
  })
})
