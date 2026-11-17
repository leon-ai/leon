import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { RELEASE_ASSET_NAME, formatReleaseNotes, selectPreviousDistribution,
  validateReleaseContent, type PublishedDistribution, type ReleaseContent } from '../../../scripts/release/release-content'
import { parseReleaseNotes } from '@/core/ota/release-notes'

import { collectRuntimeAssets } from '../../../scripts/distribution/collect-assets.js'
import { REQUIRED_RUNTIME_PLATFORMS, RUNTIME_RELEASE_ASSET } from '../../../bridges/runtime/contracts/distribution.js'

const VERSION = '2.0.0-alpha.0.2'
const content: ReleaseContent = {
  schemaVersion: 1, version: VERSION, title: 'A place for each project', summary: 'Keep **shared context** close.',
  highlights: [{ title: 'Workspaces', body: 'Group related conversations and folders.' }],
  changes: { new: ['Create workspaces.'], improvements: ['Find folders faster.'], fixes: ['Keep dialogs scrollable.'], removed: [] }
}
const published = (version: string, overrides: Partial<PublishedDistribution> = {}): PublishedDistribution => ({
  tag_name: `v${version}`, draft: false, prerelease: true, assets: [{ name: RELEASE_ASSET_NAME }], ...overrides
})

describe('release distribution content', () => {
  it('preserves authored highlights and category content in the generated public notes', () => {
    expect(validateReleaseContent(content, VERSION, `v${VERSION}`)).toBe(content)
    const notes = parseReleaseNotes(formatReleaseNotes(content))
    expect(notes.highlights).toContain('**shared context**')
    expect(notes.highlights).toContain('### Workspaces')
    expect(notes.changelog).toEqual({ new: '- Create workspaces.', improvements: '- Find folders faster.',
      fixes: '- Keep dialogs scrollable.', removed: '' })
  })

  it('rejects inconsistent, unsupported or incomplete release documents before publication', () => {
    for (const input of [null, {}, { ...content, schemaVersion: 2 }, { ...content, version: '2.0.0' },
      { ...content, summary: '' }, { ...content, title: ' ' }, { ...content, changes: { new: [] } },
      { ...content, unexpected: true }]) {
      expect(() => validateReleaseContent(input, VERSION, `v${VERSION}`)).toThrow()
    }
    expect(() => validateReleaseContent(content, VERSION, 'v2.0.0')).toThrow('tag')
    expect(() => validateReleaseContent(content, `${VERSION}+dev`, `v${VERSION}+dev`)).toThrow('without build metadata')
  })

  it('selects the newest published OTA-capable baseline in the requested channel', () => {
    const releases = [published('2.0.0-alpha.0.1'), published('2.0.0-alpha.0'),
      published('2.0.0-alpha.0.9', { draft: true }), published('1.0.0', { prerelease: false }),
      published('2.0.0-alpha.0.1.1', { assets: [] }), published('bridge_v9.0.0')]
    expect(selectPreviousDistribution(releases, VERSION)?.tag_name).toBe('v2.0.0-alpha.0.1')
    expect(selectPreviousDistribution(releases, '2.0.0')?.tag_name).toBe('v1.0.0')
  })

  it('identifies a first OTA distribution and refuses to reuse or decrease published versions', () => {
    expect(selectPreviousDistribution([published('1.0.0', { assets: [] })], '2.0.0')).toBeNull()
    expect(() => selectPreviousDistribution([published(VERSION)], VERSION)).toThrow('advance')
    expect(() => selectPreviousDistribution([published('2.0.0-alpha.1')], VERSION)).toThrow('advance')
  })
})


describe('verified Core runtime publication', () => {
  let directory: string
  const verified = { version: VERSION, commit: 'candidate-commit', runId: 'release-run' }
  const prepare = async (): Promise<void> => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-release-runtime-'))
    for (const platform of REQUIRED_RUNTIME_PLATFORMS) {
      const folder = path.join(directory, platform)
      await fs.mkdir(folder)
      const name = `leon-core-${VERSION}-${platform}.tar.gz`
      const content = Buffer.from(`verified payload for ${platform}`)
      const sha256 = createHash('sha256').update(content).digest('hex')
      const asset = { name, platform, sha256, bytes: content.length }
      const receipt = { ...verified, platform, sha256 }
      await fs.writeFile(path.join(folder, name), content)
      await fs.writeFile(path.join(folder, RUNTIME_RELEASE_ASSET), JSON.stringify({ schemaVersion: 1, version: VERSION, assets: [asset] }))
      await fs.writeFile(path.join(folder, 'runtime-verification.json'), JSON.stringify({ ...receipt, isolatedStartup: true }))
      await fs.writeFile(path.join(folder, 'runtime-ota-verification.json'), JSON.stringify({ ...receipt,
        artifactOTA: true, profilePreserved: true, profilesVerified: 2, sessionsVerified: 2,
        workspacesVerified: 2, liveInference: true, mode: 'upgrade' }))
    }
  }
  afterEach(async () => {
    if (directory) {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('combines only checksummed archives verified for the exact release workflow', async () => {
    await prepare()
    const files = await collectRuntimeAssets(directory, verified, directory)
    expect(files).toHaveLength(REQUIRED_RUNTIME_PLATFORMS.length + 1)
    const manifest = JSON.parse(await fs.readFile(path.join(directory, RUNTIME_RELEASE_ASSET), 'utf8'))
    expect(manifest.assets.map((asset: { platform: string }) => asset.platform).sort()).toEqual([...REQUIRED_RUNTIME_PLATFORMS].sort())
    await expect(collectRuntimeAssets(directory, { ...verified, commit: 'another-commit' }, directory)).rejects.toThrow()
  })

  it('blocks publication when a platform or live inference verification is missing', async () => {
    await prepare()
    const folder = path.join(directory, REQUIRED_RUNTIME_PLATFORMS[0])
    const receiptPath = path.join(folder, 'runtime-ota-verification.json')
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'))
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, sessionsVerified: 0 }))
    await expect(collectRuntimeAssets(directory, verified, directory)).rejects.toThrow('conversations, workspaces and profile isolation')
    await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, liveInference: false }))
    await expect(collectRuntimeAssets(directory, verified, directory)).rejects.toThrow()
    await fs.rm(folder, { recursive: true })
    await expect(collectRuntimeAssets(directory, verified, directory)).rejects.toThrow('Every supported release platform')
  })

  it('rejects archives modified after verification', async () => {
    await prepare()
    const folder = path.join(directory, REQUIRED_RUNTIME_PLATFORMS[0])
    const metadata = JSON.parse(await fs.readFile(path.join(folder, RUNTIME_RELEASE_ASSET), 'utf8'))
    const archive = path.join(folder, metadata.assets[0].name)
    const content = await fs.readFile(archive)
    content[0] = content[0] ^ 1
    await fs.writeFile(archive, content)
    await expect(collectRuntimeAssets(directory, verified, directory)).rejects.toThrow()
  })
})
