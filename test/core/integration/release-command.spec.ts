import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { release } from '../../../scripts/release/release'

const execute = promisify(execFile)
const VERSION = '2.0.0-alpha.0.2'
let home: string
let root: string
let remote: string
let api: http.Server
let apiStatus: number
const git = async (...args: string[]): Promise<string> =>
  (await execute('git', args, { cwd: root })).stdout.trim()
const content = {
  schemaVersion: 1, version: VERSION, title: 'A quieter update', summary: 'Keep my profiles and projects close.',
  highlights: [], changes: { new: [], improvements: ['Preserve owner data.'], fixes: [], removed: [] }
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-release-command-'))
  root = path.join(home, 'checkout')
  remote = path.join(home, 'origin.git')
  await fs.mkdir(root)
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Release fixture')
  await git('config', 'user.email', 'release@example.invalid')
  await git('init', '--bare', remote)
  await git('remote', 'add', 'origin', 'https://github.com/fixture/leon.git')
  await git('config', `url.${remote}.insteadOf`, 'https://github.com/fixture/leon.git')
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: VERSION }))
  await git('add', '.')
  await git('commit', '-m', 'Prepare version')
  await git('push', 'origin', 'main')
  apiStatus = 200
  api = http.createServer((request, response) => {
    const page = Number(new URL(request.url!, 'http://localhost').searchParams.get('page') ?? '1')
    const pages = JSON.parse(process.env['LEON_RELEASE_FIXTURE_RELEASES'] ?? '[[]]') as unknown[][]
    response.statusCode = apiStatus
    response.setHeader('Content-Type', 'application/json')
    if (page < pages.length) {
      response.setHeader('Link', `<http://127.0.0.1:${(api.address() as { port: number }).port}/releases?page=${page + 1}>; rel="next"`)
    }
    response.end(JSON.stringify(pages[page - 1] ?? []))
  })
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
  vi.stubEnv('GITHUB_API_URL', `http://127.0.0.1:${(api.address() as { port: number }).port}`)
  vi.stubEnv('GH_TOKEN', '')
  vi.stubEnv('LEON_RELEASE_FIXTURE_RELEASES', JSON.stringify([[{
    tag_name: 'v2.0.0-alpha.0.1', draft: false, prerelease: true, assets: []
  }]]))
})

afterEach(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()))
  await fs.rm(home, { recursive: true, force: true })
})

const commitContent = async (): Promise<void> => {
  await fs.writeFile(path.join(root, 'release.json'), JSON.stringify(content))
  await git('add', 'release.json')
  await git('commit', '-m', 'Review release notes')
  await git('push', 'origin', 'main')
}

it.skipIf(process.platform === 'win32')('prepares reviewable content before tagging only a clean, pushed release commit', async () => {
  await release({ root })
  expect(JSON.parse(await fs.readFile(path.join(root, 'release.json'), 'utf8'))).toMatchObject({ version: VERSION, summary: '' })
  expect(await git('ls-remote', '--tags', 'origin')).toBe('')
  await commitContent()
  await release({ root, dryRun: true })
  expect(await git('ls-remote', '--tags', 'origin')).toBe('')
  await release({ root })
  expect(await git('ls-remote', '--tags', 'origin')).toContain(`refs/tags/v${VERSION}`)
  await expect(release({ root })).rejects.toThrow('already exists upstream')
})

it.skipIf(process.platform === 'win32')('refuses reused versions, unreviewed edits and commits missing from origin', async () => {
  await commitContent()
  vi.stubEnv('LEON_RELEASE_FIXTURE_RELEASES', JSON.stringify([[{ tag_name: `v${VERSION}`, draft: false, prerelease: true, assets: [] }]]))
  await expect(release({ root })).rejects.toThrow('advance')
  vi.stubEnv('LEON_RELEASE_FIXTURE_RELEASES', '[[]]')
  await fs.writeFile(path.join(root, 'owner-edit'), 'uncommitted')
  await expect(release({ root })).rejects.toThrow('Commit and push')
  await git('add', 'owner-edit')
  await git('commit', '-m', 'Unpushed code')
  await expect(release({ root })).rejects.toThrow('Push the current branch')
  expect(await git('ls-remote', '--tags', 'origin')).toBe('')
})

it.skipIf(process.platform === 'win32')('requires successful discovery across release pages before creating metadata or tags', async () => {
  apiStatus = 429
  await expect(release({ root })).rejects.toThrow('Could not check published releases (429)')
  await expect(fs.access(path.join(root, 'release.json'))).rejects.toThrow()
  apiStatus = 200
  vi.stubEnv('LEON_RELEASE_FIXTURE_RELEASES', JSON.stringify([[], [{ tag_name: `v${VERSION}`, draft: false, prerelease: true, assets: [] }]]))
  await expect(release({ root })).rejects.toThrow('advance')
  expect(await git('ls-remote', '--tags', 'origin')).toBe('')
})
