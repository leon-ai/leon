import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { HabitsContextFile } from '@/core/context-manager/context-files/habits-context-file'
import { LocalInventoryContextFile } from '@/core/context-manager/context-files/local-inventory-context-file'
import { MediaProfileContextFile } from '@/core/context-manager/context-files/media-profile-context-file'
import { WorkspaceIntelligenceContextFile } from '@/core/context-manager/context-files/workspace-intelligence-context-file'
import { SystemHelper } from '@/helpers/system-helper'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('@/config', () => ({
  CONFIG_MANAGER: { getConfig: (): { time_zone: string } => ({ time_zone: 'UTC' }) }
}))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): { context: string } => ({ context: fixture.root })
}))
vi.mock('@/helpers/log-helper', () => ({ LogHelper: { title: vi.fn(), warning: vi.fn() } }))

const FIRST_SAMPLE = '2026-05-01T10:00:00.000Z'
const SECOND_SAMPLE = '2026-05-01T11:00:00.000Z'
const SAMPLE_INTERVAL_MS = 3_600_000
const EPOCH = new Date(0).toISOString()

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-context-telemetry-'))
  vi.setSystemTime(new Date(FIRST_SAMPLE))
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await fs.rm(fixture.root, { recursive: true, force: true })
})

function stubRunningApps(helper: ContextProbeHelper, names: string[]): void {
  vi.spyOn(helper, 'probeRunningProcesses').mockImplementation(() => ({
    source: 'process snapshot',
    sampledAt: new Date().toISOString(),
    entries: names.map((name, index) => ({
      pid: index + 1,
      name,
      cpu: 0,
      cpuMetric: 'percent',
      memoryMb: 0,
      runtimeSeconds: 0,
      startedAt: FIRST_SAMPLE
    }))
  }))
}

it('retains only host-level visit signals in the derived media profile', async () => {
  const helper = new ContextProbeHelper()
  stubRunningApps(helper, [])
  const historyPath = path.join(fixture.root, 'BROWSER_HISTORY.md')
  const statePath = path.join(fixture.root, '.media-profile-state.json')
  const callback = 'https://example.test/callback?code=sample-code#session'
  const history = [
    '# BROWSER_HISTORY',
    `- 1. ${FIRST_SAMPLE} | ${callback} | title: Account authorization`,
    `- 2. ${FIRST_SAMPLE} | https://example.test/private/page | title: Private page`
  ].join('\n')

  await fs.writeFile(historyPath, history)
  await fs.writeFile(statePath, JSON.stringify({
    trackingStartedAt: EPOCH,
    lastSampleAt: EPOCH,
    domains: { [callback]: 5 },
    seenEntries: { [`${FIRST_SAMPLE}|${callback}|Account authorization`]: FIRST_SAMPLE }
  }))

  const profile = new MediaProfileContextFile(helper, SAMPLE_INTERVAL_MS)
  expect(profile.generate()).toContain('example.test: 2 hit(s)')
  vi.setSystemTime(new Date(SECOND_SAMPLE))
  expect(profile.generate()).toContain('example.test: 2 hit(s)')

  const stored = await fs.readFile(statePath, 'utf8')
  expect(JSON.parse(stored)).toMatchObject({
    trackingStartedAt: FIRST_SAMPLE,
    hostnames: { 'example.test': 2 }
  })
  expect(stored).not.toMatch(/sample-code|private\/page|Account authorization|Private page/)
  expect(await fs.readFile(historyPath, 'utf8')).toBe(history)
})

it('counts sampled time once while preserving older per-app presence', async () => {
  const helper = new ContextProbeHelper()
  stubRunningApps(helper, Array.from({ length: 10 }, (_, index) => `process-${index}`))
  const statePath = path.join(fixture.root, '.habits-state.json')
  await fs.writeFile(statePath, JSON.stringify({
    trackingStartedAt: EPOCH,
    lastSampleAt: EPOCH,
    timeBuckets: { morning: { 'older-process': 36_000 } }
  }))

  const habits = new HabitsContextFile(helper, SAMPLE_INTERVAL_MS)
  expect(habits.generate()).toContain('0m 0s of process monitoring')
  vi.setSystemTime(new Date(SECOND_SAMPLE))
  const content = habits.generate()

  expect(content).toContain('low confidence from 1h 0m 0s of process monitoring')
  expect(content).toContain('process-0: 1h 0m 0s')
  expect(content).toContain('older-process: 10h 0m 0s')
  expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toMatchObject({
    trackingStartedAt: FIRST_SAMPLE,
    sampledSeconds: 3_600
  })
})

it('distinguishes installed app entries, running app groups and command probes', () => {
  const helper = new ContextProbeHelper()
  stubRunningApps(helper, ['firefox.exe', 'firefox.exe'])
  vi.spyOn(SystemHelper, 'isWindows').mockReturnValue(true)
  vi.spyOn(helper, 'runCommand').mockImplementation((_command, args) => (
    args.some((arg) => arg.includes('Get-StartApps'))
      ? JSON.stringify([{ Name: 'Chrome' }, { Name: 'Firefox' }, { Name: 'Python' }])
      : null
  ))
  vi.spyOn(process, 'cwd').mockReturnValue(fixture.root)
  vi.spyOn(os, 'homedir').mockReturnValue(fixture.root)

  const inventory = new LocalInventoryContextFile(helper, SAMPLE_INTERVAL_MS).generate()
  const workspace = new WorkspaceIntelligenceContextFile(helper, SAMPLE_INTERVAL_MS).generate()

  expect(inventory).toContain('## Installed App Entry Categories\n- 1. browser: 2')
  expect(inventory).toContain('## Current Running App Group Categories\n- 1. browser: 1')
  expect(inventory).toContain('3. Python')
  expect(workspace).toContain('python --version: command probe unsuccessful')
})
