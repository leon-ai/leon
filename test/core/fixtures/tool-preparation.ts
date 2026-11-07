import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

import { ToolWorkerManager } from '@/core/tool-manager/tool-worker-manager'
import { getPlatformName } from '@sdk/utils/platform'

export type PreparationCase = 'resource' | 'binary' | 'parallel' | 'stop' | 'complete' | 'action'

/**
 * Exercises host cancellation against real, gated local asset downloads.
 * All files and worker state belong to this disposable home, not an owner profile.
 */
export async function exerciseToolPreparation(mode: PreparationCase): Promise<Record<string, unknown>> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-preparation-'))
  const previousHome = process.env['LEON_HOME']
  process.env['LEON_HOME'] = home
  const manager = new ToolWorkerManager()
  const owner = new AbortController()
  const turn = new AbortController()
  const received = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const expectedDownloads = mode === 'parallel' ? 2 : 1
  const content = Buffer.from('#!/bin/sh\nexit 0\n')
  let downloads = 0
  let preparing = false
  const server = createServer(async (request, response) => {
    response.writeHead(200, { 'Content-Length': content.length, 'Content-Type': 'application/octet-stream' })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    downloads += 1
    response.write(content.subarray(0, 4))
    if (downloads === expectedDownloads) {
      received.resolve()
    }
    await release.promise
    response.end(content.subarray(4))
  })

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}`
    const directory = path.join(home, 'profiles', 'a', 'tools', 'fixture', 'preparation')
    await fs.mkdir(path.join(directory, 'src', 'nodejs'), { recursive: true })
    await fs.writeFile(path.join(directory, 'tool.json'), JSON.stringify({
      binaries: { [getPlatformName()]: `${url}/fixture-1.0.0` },
      resources: { first: [`${url}/first.bin`], second: [`${url}/second.bin`] }
    }))
    await fs.writeFile(path.join(directory, 'src', 'nodejs', 'index.ts'), `
import fs from 'node:fs/promises'
import path from 'node:path'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { PROFILE_TOOLS_PATH } from '@bridge/constants'
import { readFileSync } from 'node:fs'
// Fixture manifests stay outside the checkout; asset helpers and transport remain real.
ToolkitConfig.load = () => JSON.parse(readFileSync(
  path.join(PROFILE_TOOLS_PATH, 'fixture', 'preparation', 'tool.json'), 'utf8'))
export default class PreparationFixture extends Tool {
  toolName = 'preparation'; toolkit = 'fixture'; description = 'Host preparation fixture'
  async run(mode) {
    if (mode === 'binary') {
      await this.getBinaryPath('fixture')
    } else {
      await Promise.all((mode === 'parallel' ? ['first', 'second'] : ['first'])
        .map((name) => this.getResourcePath(name)))
    }
    await fs.writeFile(path.join(process.env.LEON_HOME, 'ran-action'), 'executed')
    if (mode === 'action') {
      this.executionContext.onProgress({ source: 'log', message: 'Action started.' })
      await new Promise((resolve) => this.executionContext.signal.addEventListener('abort', resolve, { once: true }))
    }
    return { executed: true }
  }
}
`)
    const pending = manager.execute({
      toolkitId: 'fixture', toolId: 'preparation', functionName: 'run',
      profileName: 'a', conversationSessionId: 'preparation-session', parameters: {},
      signal: owner.signal, preparationSignal: turn.signal,
      onProgress: (progress) => {
        if (progress.phase === 'preparation') {
          preparing = true
        }
        if (progress.message === 'Action started.') {
          owner.abort(new Error('New owner instructions require reassessment.'))
        }
      }
    }, [mode], () => {})
    await Promise.race([
      received.promise,
      pending.then((result) => {
        throw new Error(`Worker settled before preparation started: ${JSON.stringify(result)}`)
      })
    ])
    assert.equal(preparing, true)
    if (mode === 'stop') {
      turn.abort(new Error('Stopped by the owner.'))
      owner.abort(new Error('Stopped by the owner.'))
    } else if (mode !== 'complete' && mode !== 'action') {
      owner.abort(new Error('New owner instructions require reassessment.'))
    }
    if (mode !== 'stop') {
      release.resolve()
    }
    const result = await pending
    const executed = await fs.stat(path.join(home, 'ran-action')).then(() => true, () => false)
    assert.equal(result.success, mode === 'complete', JSON.stringify(result))
    assert.equal(executed, mode === 'complete' || mode === 'action')
    if (mode !== 'stop') {
      const assets = path.join(home, 'toolkits', 'fixture', 'assets')
      if (mode === 'binary') {
        const files = await fs.readdir(assets)
        assert.equal(files.some((name) => name.startsWith('fixture-1.0.0')), true)
      } else {
        assert.deepEqual(await fs.readFile(path.join(assets, 'first', 'first.bin')), content)
        if (mode === 'parallel') {
          assert.deepEqual(await fs.readFile(path.join(assets, 'second', 'second.bin')), content)
        }
      }
    }

    return { mode, downloads, executed, success: result.success }
  } finally {
    release.resolve()
    await manager.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousHome === undefined) {
      delete process.env['LEON_HOME']
    } else {
      process.env['LEON_HOME'] = previousHome
    }
    await fs.rm(home, { recursive: true, force: true })
  }
}
