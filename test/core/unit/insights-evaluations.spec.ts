import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import axios from 'axios'
import { expect, it, vi } from 'vitest'

import { runWithProfileContext, getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { projectEvaluationHistory } from '@/core/insights/evaluation-view'
import type { EvaluationRun } from '@/core/insights/insights-contract'

const fixture = vi.hoisted(() => ({ directory: '' }))

vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): { logs: string } => ({
    logs: path.join(fixture.directory, getActiveProfileName(), 'logs')
  })
}))

vi.mock('@/constants', () => ({
  GITHUB_URL: 'https://github.com/leon-ai/leon',
  get LEON_HOME_PATH(): string {
    return fixture.directory
  }
}))

it('returns filtered chart points and a bounded checkpoint page without case payloads', () => {
  const measured = {
    inputTokens: 100, outputTokens: 25, cachedInputTokens: 40, uncachedInputTokens: 60,
    peakInputTokens: 90, modelCalls: 2, failedCalls: 0, foregroundInputTokens: 100,
    maintenanceInputTokens: 0, turnLatencyMs: 1_500
  }
  const runs: EvaluationRun[] = Array.from({ length: 35 }, (_, index) => ({
    id: String(index), sha: String(index), model: 'fixture', reasoning: 'high',
    recordedAt: Date.UTC(2030, 0, 1) + index, committedAt: Date.UTC(2029, 11, 31) + index,
    cases: [
      { scenario: 'lookup', status: 'Passed', baseline: measured, measured, samples: 1 },
      { scenario: 'recall', status: 'Warning', baseline: measured, samples: 2,
        measured: index === 0 ? null : { ...measured, peakInputTokens: 120, turnLatencyMs: 4_500 } }
    ]
  }))

  const suite = projectEvaluationHistory(runs, { page: 1 })
  expect(suite.rows).toHaveLength(10)
  expect(suite.rows[0]).not.toHaveProperty('cases')
  expect(suite.points).toHaveLength(35)
  expect(suite.points[0]).toMatchObject({ sha: '0', measured: null })
  expect(suite.points[1]).toMatchObject({
    sha: '1', date: runs[1]?.committedAt,
    measured: { inputTokens: 200, peakInputTokens: 120, turnLatencyMs: 3_000 },
    outcomes: { Passed: 1, Warning: 1, Failed: 0 }
  })
  const scenario = projectEvaluationHistory(runs, { scenario: 'lookup' })
  expect(scenario.rows).toHaveLength(25)
  expect(scenario.points[0]).toMatchObject({ measured, outcomes: { Passed: 1, Warning: 0 } })
})

it('shares one conditional evaluation-index refresh while retaining profile-specific history', async () => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-insights-evaluation-index-'))
  const { readEvaluationHistory } = await import('@/core/insights/evaluation-index')
  const recordedAt = Date.UTC(2030, 0, 1)
  let now = recordedAt
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const index = { schemaVersion: 1, runs: [{
    id: 'test-public-run', sha: 'a'.repeat(40), version: '2.0.0-alpha.0.10',
    model: 'deepseek/deepseek-flash', reasoning: 'high', suiteRevision: 'b'.repeat(64),
    recordedAt, durationMs: 30_000, runId: '42', attempt: 1, source: 'release',
    cases: [{ scenario: 'selected-lookup', status: 'Warning', samples: 0, baseline: null, measured: null }]
  }] }
  const downloads = vi.spyOn(axios, 'get')
    .mockResolvedValueOnce({ status: 200, data: index, headers: { etag: '"archive-1"' } })
    .mockResolvedValueOnce({ status: 304, headers: {} })

  try {
    const history = path.join(fixture.directory, 'index-owner', 'logs', 'evaluations')
    const id = 'c'.repeat(64)
    const saved: EvaluationRun = {
      id, sha: 'd'.repeat(40), model: 'deepseek/deepseek-flash', reasoning: 'high', recordedAt,
      cases: [{ scenario: 'selected-lookup', status: 'Failed', samples: 0, baseline: null, measured: null }]
    }
    await fs.mkdir(history, { recursive: true })
    await fs.writeFile(path.join(history, `${id}.json`), JSON.stringify(saved))

    expect(await runWithProfileContext({ profileName: 'index-owner' }, () => readEvaluationHistory(false))).toHaveLength(1)
    expect(downloads).not.toHaveBeenCalled()
    const [owner, other] = await Promise.all(['index-owner', 'other-owner'].map((profileName) =>
      runWithProfileContext({ profileName }, () => readEvaluationHistory(true))
    ))
    expect(owner).toHaveLength(2)
    expect(other).toMatchObject([{ source: 'release', runId: '42' }])
    await runWithProfileContext({ profileName: 'another-owner' }, () => readEvaluationHistory(true))
    expect(downloads).toHaveBeenCalledTimes(1)
    now += 5 * 60_000
    expect(await runWithProfileContext({ profileName: 'another-owner' }, () => readEvaluationHistory(true))).toHaveLength(1)
    expect(downloads).toHaveBeenLastCalledWith(expect.stringMatching(/eval-history\/quick-evals\/index\.json$/),
      expect.objectContaining({ headers: expect.objectContaining({ 'If-None-Match': '"archive-1"' }) }))
    expect(downloads).toHaveBeenCalledTimes(2)
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true })
  }
})
