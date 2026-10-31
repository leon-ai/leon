import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { LogHelper } from '@/helpers/log-helper'
import { LLMProviders, LLMDuties, type CompletionAttemptTiming } from '@/core/llm-manager/types'
import { getTurnTimings, recordTurnInference, runOutsideTurnTiming, runTurnPhase,
  runWithTurnTiming, setTurnPhaseGoal, setTurnTimingSession, TurnPhase } from '@/core/llm-manager/turn-timing'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('@/core/profile-runtime/profile-paths', async (importOriginal) => {
  const paths = await import('node:path')
  const actual = await importOriginal<typeof import('@/core/profile-runtime/profile-paths')>()

  return {
    ...actual,
    getProfilePaths: (profile?: string): ReturnType<typeof actual.getProfilePaths> => {
      const resolved = actual.getProfilePaths(profile)

      return {
        ...resolved,
        logs: fixture.root ? paths.join(fixture.root, resolved.name, 'logs') : resolved.logs
      }
    }
  }
})

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-turn-timing-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(fixture.root, { recursive: true, force: true })
})

it('logs phases and each inference once with profile, session, turn and parent ownership', async () => {
  await Promise.all(['first', 'second'].map((profile) => runWithProfileContext({ profileName: profile }, () =>
    runWithTurnTiming(profile, null, async () => {
      setTurnTimingSession(`${profile}-session`)
      await runTurnPhase(TurnPhase.Request, async () => {
        const timing: CompletionAttemptTiming = {
          attemptId: `${profile}-attempt`, startedAt: Date.now(), elapsedMs: 0,
          provider: LLMProviders.OpenAI, model: 'fixture-model', duty: LLMDuties.ReAct,
          transport: 'http', outcome: 'started', inferenceTimeoutMs: 1_000, streamIdleTimeoutMs: 1_000,
          providerEventCount: 0, providerCompleted: false, lastEvent: 'dispatched'
        }
        recordTurnInference(timing)
        await Promise.resolve()
        recordTurnInference({ ...timing, elapsedMs: 12, firstTokenMs: 5, outcome: 'completed' })
        setTurnPhaseGoal(TurnPhase.Tools)
        runOutsideTurnTiming(() => runTurnPhase(TurnPhase.Review, () => undefined))
      })
    })
  )))
  for (const profile of ['first', 'second']) {
    const directory = path.join(fixture.root, profile, 'logs', 'turns')
    const [filename] = await fs.readdir(directory)
    expect(filename).toBe(`${new Date().toISOString().slice(0, 10)}.jsonl`)
    const records = (await fs.readFile(path.join(directory, filename!), 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records.every((record) => record['profile'] === profile && record['sessionId'] === `${profile}-session` && record['turnId'] === profile)).toBe(true)
    const inference = records.filter((record) => record['kind'] === 'inference')
    expect(inference).toHaveLength(1)
    expect(inference[0]).toMatchObject({ id: `${profile}-attempt`, goal: TurnPhase.Tools, durationMs: 12, outcome: 'completed' })
    expect(records.some((record) => record['id'] === inference[0]!['parentId'])).toBe(true)
    expect(records.filter((record) => record['parentId'] === `${profile}-attempt`).map((record) => record['durationMs'])).toEqual([5, 7])
    expect(records.some((record) => record['goal'] === TurnPhase.Review)).toBe(false)
    expect(records.every((record) => Number(record['endedAt']) >= Number(record['startedAt']))).toBe(true)
  }
  expect(getTurnTimings()).toEqual([])
})

it('writes failed phases without retaining exception text or changing the failure', async () => {
  const failure = new Error('private exception body')
  await expect(runWithProfileContext({ profileName: 'owner' }, () =>
    runWithTurnTiming('failed-turn', 'session', async () => runTurnPhase(TurnPhase.Context, () => {
      throw failure
    }))
  )).rejects.toBe(failure)
  const directory = path.join(fixture.root, 'owner', 'logs', 'turns')
  const [filename] = await fs.readdir(directory)
  const contents = await fs.readFile(path.join(directory, filename!), 'utf8')
  expect(contents).toContain('"outcome":"failed"')
  expect(contents).not.toContain(failure.message)
})

it('rolls records across UTC days without losing their turn association', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-30T23:59:59Z'))
  await runWithProfileContext({ profileName: 'owner' }, () => runWithTurnTiming('midnight', 'session', async () => {
    runTurnPhase(TurnPhase.Context, () => undefined)
    now.mockReturnValue(Date.parse('2026-10-31T00:00:01Z'))
    runTurnPhase(TurnPhase.Provider, () => undefined)
  }))
  const directory = path.join(fixture.root, 'owner', 'logs', 'turns')
  expect((await fs.readdir(directory)).sort()).toEqual(['2026-10-30.jsonl', '2026-10-31.jsonl'])
  expect(await fs.readFile(path.join(directory, '2026-10-31.jsonl'), 'utf8')).toContain('"turnId":"midnight"')
})

it('returns the answer even if the diagnostic log cannot be written', async () => {
  vi.spyOn(fs, 'appendFile').mockRejectedValue(new Error('fixture write failure'))
  const warning = vi.spyOn(LogHelper, 'warning').mockImplementation(() => undefined)
  await expect(runWithProfileContext({ profileName: 'owner' }, () =>
    runWithTurnTiming('turn', 'session', async () => 'answer')
  )).resolves.toBe('answer')
  expect(warning).toHaveBeenCalledOnce()
  expect(getTurnTimings()).toEqual([])
})

it('keeps concurrent turns in one profile as intact independent JSONL records', async () => {
  await runWithProfileContext({ profileName: 'owner' }, () => Promise.all(
    Array.from({ length: 8 }, (_, index) => runWithTurnTiming(`turn-${index}`, `session-${index}`, async () => {
      await runTurnPhase(TurnPhase.Context, async () => Promise.resolve())
    }))
  ))
  const directory = path.join(fixture.root, 'owner', 'logs', 'turns')
  const [filename] = await fs.readdir(directory)
  const records = (await fs.readFile(path.join(directory, filename!), 'utf8')).trim().split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(records).toHaveLength(16)
  expect(new Set(records.map((record) => record['turnId'])).size).toBe(8)
  expect(records.every((record) => record['outcome'] === 'completed')).toBe(true)
})
