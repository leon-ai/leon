import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import setupToolsDependencies from '@@/scripts/setup/setup-tools-dependencies'

const fixture = vi.hoisted(() => ({ builtIn: '', profile: '', node: vi.fn(), python: vi.fn() }))
vi.mock('@/constants', () => ({
  get TOOLS_PATH(): string { return fixture.builtIn },
  get PROFILE_TOOLS_PATH(): string { return fixture.profile }
}))
vi.mock('@@/scripts/setup/sync-source-dependencies', () => ({
  syncNodejsSourceDependencies: fixture.node,
  syncPythonSourceDependencies: fixture.python
}))

let directory = ''
afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

it('uses both existing dependency installers for flat, nested and profile tool sources', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-tool-dependencies-'))
  fixture.builtIn = path.join(directory, 'built-in')
  fixture.profile = path.join(directory, 'profile')
  const tools = [
    path.join(fixture.builtIn, 'browser_use'),
    path.join(fixture.builtIn, 'video_streaming', 'ffmpeg'),
    path.join(fixture.profile, 'weather', 'custom')
  ]
  for (const tool of tools) {
    await fs.mkdir(tool, { recursive: true })
    await fs.writeFile(path.join(tool, 'tool.json'), '{}')
  }
  await setupToolsDependencies()
  for (const tool of tools) {
    for (const language of ['nodejs', 'python']) {
      const source = path.join(tool, 'src', language)
      expect(fixture.node).toHaveBeenCalledWith(source)
      expect(fixture.python).toHaveBeenCalledWith(source)
    }
  }
  expect(fixture.node).toHaveBeenCalledTimes(6)
  expect(fixture.python).toHaveBeenCalledTimes(6)
})
