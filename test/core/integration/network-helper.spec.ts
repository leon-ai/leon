import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { NetworkHelper } from '@/helpers/network-helper'

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
