import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import setupLocalLLM, { downloadLocalLLM } from '@@/scripts/setup/setup-local-llm'

const fixture = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  return {
    root: await fs.mkdtemp(path.join(os.tmpdir(), 'leon-model-install-')),
    config: { default: 'llamacpp', workflow: '', agent: '' },
    setValue: vi.fn(), select: vi.fn()
  }
})
vi.mock('@/constants', () => ({
  LLM_DIR_PATH: fixture.root,
  LLM_MANIFEST_PATH: path.join(fixture.root, 'manifest.json'),
  LLAMACPP_RELEASE_VERSION: 'fixture-runtime',
  MINIMUM_LOCAL_CONTEXT_TOKENS: 4_096,
  LLAMACPP_DEFAULT_KV_CACHE_TYPE: 'q8_0'
}))
vi.mock('@/config', () => ({ CONFIG_MANAGER: {
  getConfig: (): object => ({ llm: fixture.config }), setValue: fixture.setValue
} }))
vi.mock('@@/scripts/setup/local-llm-selection', async (load) => ({
  ...await load<typeof import('@@/scripts/setup/local-llm-selection')>(), selectLocalLLM: fixture.select
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }
}))

const weights = Buffer.from('verified model fixture')
let corrupt = false
const server = createServer((_request, response) => {
  const body = corrupt ? Buffer.alloc(weights.length) : weights
  response.setHeader('Content-Length', body.length)
  response.end(body)
})
let endpoint: string

beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture server address')
  }
  endpoint = `http://127.0.0.1:${address.port}/weights.gguf`
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
  await fs.rm(fixture.root, { recursive: true, force: true })
})

function selected(fileName: string): Record<string, unknown> {
  return {
    fileName, name: 'Fixture', precision: 'BF16',
    sizeBytes: weights.length, downloadURL: endpoint,
    checksum: createHash('sha256').update(weights).digest('hex'),
    repository: 'publisher/fixture', revision: 'pinned-revision',
    estimatedTPS: 25, score: 90, kvCacheType: 'q4_0',
    contextPlan: { contextTokens: 65_536, estimatedMiB: 8_000,
      hostBudgetMiB: 12_000, memoryBudgetMiB: 12_000 }
  }
}

describe('managed model downloads', () => {
  it('publishes verified weights without changing another profile’s shared default', async () => {
    const previousPath = path.join(fixture.root, 'previous.gguf')
    const manifestPath = path.join(fixture.root, 'manifest.json')
    const previousManifest = JSON.stringify({ defaultInstalledLLMPath: previousPath })
    await fs.writeFile(previousPath, 'previous working model')
    await fs.writeFile(manifestPath, previousManifest)
    corrupt = false

    const installed = await downloadLocalLLM(selected('selected.gguf'))
    expect(await fs.readFile(installed)).toEqual(weights)
    expect(await fs.readFile(previousPath, 'utf8')).toBe('previous working model')
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(previousManifest)
    const metadata = JSON.parse(await fs.readFile(`${installed}.manifest.json`, 'utf8'))
    expect(metadata.revision).toBe('pinned-revision')
    expect(metadata.contextWindowTokens).toBe(65_536)
    expect(metadata.kvCacheType).toBe('q4_0')
  })

  it('retains working weights when a replacement fails checksum verification', async () => {
    const targetPath = path.join(fixture.root, 'replacement.gguf')
    await fs.writeFile(targetPath, 'working weights')
    corrupt = true

    await expect(downloadLocalLLM(selected('replacement.gguf'))).rejects.toThrow('checksum')
    expect(await fs.readFile(targetPath, 'utf8')).toBe('working weights')
    expect((await fs.readdir(fixture.root)).some((name) => name.endsWith('.download'))).toBe(false)
  })

  it('keeps an existing build when the source republishes the same filename', async () => {
    const previousPath = path.join(fixture.root, 'republished.gguf')
    await fs.writeFile(previousPath, 'previous working build')
    corrupt = false

    const installed = await downloadLocalLLM(selected('republished.gguf'))
    expect(installed).not.toBe(previousPath)
    expect(await fs.readFile(previousPath, 'utf8')).toBe('previous working build')
    expect(await fs.readFile(installed)).toEqual(weights)
  })

  it('pins new local choices to the profile while preserving remote overrides', async () => {
    fixture.config = { default: 'llamacpp', workflow: 'llamacpp', agent: 'openai/owner-model' }
    fixture.select.mockResolvedValue(selected('selected.gguf'))
    fixture.setValue.mockClear()
    corrupt = false

    await setupLocalLLM({ canInstallLocalAI: true, hasGPU: true })
    expect(fixture.select).toHaveBeenCalled()
    expect(fixture.setValue.mock.calls).toEqual([
      [['llm', 'default'], 'llamacpp/selected.gguf'],
      [['llm', 'workflow'], 'llamacpp/selected.gguf']
    ])
  })

  it('retains an explicit model without running automatic selection again', async () => {
    fixture.config = { default: 'llamacpp/owner.gguf', workflow: '', agent: '' }
    fixture.select.mockClear()
    fixture.setValue.mockClear()

    await setupLocalLLM({ canInstallLocalAI: true, hasGPU: true })
    expect(fixture.select).not.toHaveBeenCalled()
    expect(fixture.setValue).not.toHaveBeenCalled()
  })

  it('binds a fresh profile only after the selected model has been verified', async () => {
    fixture.config = { default: '', workflow: '', agent: '' }
    fixture.select.mockResolvedValue(selected('selected.gguf'))
    fixture.setValue.mockClear()
    corrupt = false

    await setupLocalLLM({ canInstallLocalAI: true, hasGPU: true })
    expect(fixture.setValue.mock.calls).toEqual([
      [['llm', 'default'], 'llamacpp/selected.gguf']
    ])
  })

  it('caches an owner-requested reference without advertising an unverified allocation', async () => {
    const manifestPath = path.join(fixture.root, 'manifest.json')
    await fs.rm(manifestPath, { force: true })
    corrupt = false

    const installed = await downloadLocalLLM({ ...selected('reference.gguf'), contextPlan: undefined })
    expect(await fs.stat(manifestPath).catch(() => null)).toBeNull()
    const metadata = JSON.parse(await fs.readFile(`${installed}.manifest.json`, 'utf8'))
    expect(metadata.contextWindowTokens).toBeUndefined()
  })
})
