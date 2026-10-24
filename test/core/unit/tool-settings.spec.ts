import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import * as profiles from '@/core/profile-runtime/profile-paths'
import { ToolSettings } from '@/core/tool-manager/tool-settings'

let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-core-settings-'))
  const getProfilePaths = profiles.getProfilePaths
  vi.spyOn(profiles, 'getProfilePaths').mockImplementation((name = 'settings-a') => ({
    ...getProfilePaths(name),
    tools: path.join(directory, name, 'tools')
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

it('keeps defaults and fresh owner edits isolated by profile while saving private settings', () => {
  const filename = path.join(directory, 'settings-a/tools/example/account/settings.json')
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, JSON.stringify({ nested: { enabled: null }, owner: 'retained' }))

  const settings = ToolSettings.loadToolSettings(
    'example', 'account', { nested: { enabled: true, limit: 2 } }, true, 'settings-a'
  )
  expect(settings).toEqual({ nested: { enabled: null, limit: 2 }, owner: 'retained' })

  ToolSettings.saveToolSettings('example', 'account', { secret: 'private' }, 'settings-a')
  expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toEqual({ ...settings, secret: 'private' })
  expect(fs.readdirSync(path.dirname(filename))).toEqual(['settings.json'])
  if (process.platform !== 'win32') {
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600)
  }

  expect(ToolSettings.loadToolSettings('example', 'account', {}, false, 'settings-b')).toEqual({})
  fs.writeFileSync(filename, JSON.stringify({ owner: 'edited externally' }))
  expect(ToolSettings.loadToolSettings('example', 'account', {}, true, 'settings-a'))
    .toEqual({ owner: 'edited externally' })
})

it('rejects malformed owner settings without replacing their bytes', () => {
  const filename = path.join(directory, 'settings-a/tools/example/account/settings.json')
  const content = '{"private":"unfinished'
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, content)

  expect(() => ToolSettings.saveToolSettings('example', 'account', { owner: 'edit' }, 'settings-a'))
    .toThrow()
  expect(fs.readFileSync(filename, 'utf8')).toBe(content)
})
