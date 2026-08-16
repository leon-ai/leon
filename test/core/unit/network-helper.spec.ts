import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { NetworkHelper } from '@/helpers/network-helper'

describe('NetworkHelper', () => {
  const temporaryPaths: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()

    for (const temporaryPath of temporaryPaths.splice(0)) {
      fs.rmSync(temporaryPath, { recursive: true, force: true })
    }
  })

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

      if (stalledRangeStart === null && rangeRequests.length === 2) {
        stalledRangeStart = start
        response.writeHead(206, {
          'content-length': rangeLength,
          'content-range': `bytes ${start}-${end}/${totalBytes}`
        })
        response.write(Buffer.alloc(partialBytes, 'b'))
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
    vi.spyOn(LogHelper, 'warning').mockImplementation(() => {})

    try {
      await NetworkHelper.downloadFile(
        `http://127.0.0.1:${address.port}/model.gguf`,
        destinationPath,
        {
          cliProgress: false,
          inactivityTimeoutMs: 100,
          parallelStreams: 3,
          retry: {
            retries: 1,
            minTimeout: 1,
            maxTimeout: 1
          }
        }
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    expect(rangeRequests).toHaveLength(4)
    expect(Math.min(...rangeRequests.map(({ start }) => start))).toBe(
      existingPrefixBytes
    )
    expect(stalledRangeStart).not.toBeNull()
    expect(rangeRequests).toContainEqual(
      expect.objectContaining({
        start: (stalledRangeStart as number) + partialBytes
      })
    )
    expect(fs.statSync(destinationPath).size).toBe(totalBytes)

    const fileHandle = fs.openSync(destinationPath, 'r')
    const sample = Buffer.alloc(3)
    fs.readSync(fileHandle, sample, 0, 1, 0)
    fs.readSync(fileHandle, sample, 1, 1, Math.floor(totalBytes / 2))
    fs.readSync(fileHandle, sample, 2, 1, totalBytes - 1)
    fs.closeSync(fileHandle)
    expect(sample).toEqual(Buffer.from('bbb'))
  })
})
