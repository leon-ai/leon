import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import SelfModelManager from '@/core/self-model-manager/self-model-manager'
import { buildOwnerDocument, normalizeOwnerProfile, getOwnerContextPath } from '@/core/context-manager/owner-profile'
import { LogHelper } from '@/helpers/log-helper'

const fixture = vi.hoisted(() => ({ root: '', infer: vi.fn() }))
vi.mock('@/core/llm-manager/inference', () => ({ runInference: fixture.infer }))
vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): { time_zone: string, runtime: { private_diary_enabled: boolean } } => ({
  time_zone: 'UTC', runtime: { private_diary_enabled: true }
}) } }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): { context: string } => ({ context: fixture.root })
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), success: vi.fn(), warning: vi.fn(), debug: vi.fn() }
}))

const OBSERVATION = {
  userMessage: 'For future conversations, I generally prefer detailed explanations with practical examples, unless I explicitly ask for a short answer.',
  assistantMessage: 'I will follow that general preference.', route: 'react' as const
}

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-self-model-'))
  fixture.infer.mockReset()
})
afterEach(async () => {
  await fs.rm(fixture.root, { recursive: true, force: true })
})

it('records basic lookups and reflects periodically while responding immediately to a failed tool', async () => {
  const manager = new SelfModelManager()
  const lookup = {
    userMessage: 'What is the weather?',
    route: 'react' as const,
    routineLookup: true,
    toolExecutions: [{ functionName: 'weather.lookup', status: 'success' as const, observation: 'Clear' }]
  }

  for (const city of ['Shenzhen', 'Paris', 'Haarlem']) {
    await manager.observeTurn({ ...lookup, assistantMessage: `Clear in ${city}.` })
  }
  expect(fixture.infer).not.toHaveBeenCalled()
  const diary = await fs.readFile(manager.getDiaryPath(), 'utf8')
  expect(diary).toContain('Observed turns: 3')
  expect(diary).toContain('Tool successes: 3')

  fixture.infer.mockResolvedValue({ output: { retrospection: 'I retain useful observations.' } })
  await manager.observeTurn({ ...lookup, assistantMessage: 'Clear in Calgary.' })
  expect(fixture.infer).toHaveBeenCalledTimes(1)

  await manager.observeTurn({ ...lookup, routineLookup: false, assistantMessage: 'The lookup failed.',
    toolExecutions: [{ functionName: 'weather.lookup', status: 'error', observation: 'Unavailable' }]
  })
  expect(fixture.infer).toHaveBeenCalledTimes(2)
})

it('replaces contradicted hypotheses while preserving unrelated learning across restarts', async () => {
  const manager = new SelfModelManager()
  fixture.infer.mockResolvedValueOnce({ output: {
    current_focus: ['Answer the current question briefly.'],
    working_theories: ['The owner generally prefers concise answers.', 'The owner enjoys worked examples.'],
    behavioral_principles: [{ text: 'I verify important results.', confidence: 0.9 }]
  } })
  await manager.observeTurn({ ...OBSERVATION, userMessage: 'Give this particular answer in one sentence. '.repeat(3) })
  const owner = normalizeOwnerProfile({ interactionPreferences: ['Prefers detailed explanations unless requesting brevity.'] })
  await fs.writeFile(getOwnerContextPath(), buildOwnerDocument(owner))

  fixture.infer.mockResolvedValueOnce({ output: {
    current_focus: [],
    working_theories: ['The owner generally prefers detailed answers.', 'The owner enjoys worked examples.']
  } })
  await manager.observeTurn(OBSERVATION)

  const restarted = new SelfModelManager()
  expect(restarted.getSnapshot()).toContain('generally prefers detailed answers')
  expect(restarted.getSnapshot()).toContain('enjoys worked examples')
  expect(restarted.getSnapshot()).toContain('I verify important results.')
  expect(restarted.getSnapshot()).not.toContain('generally prefers concise answers')
  expect(restarted.getSnapshot()).not.toContain('Answer the current question briefly.')
  const diary = await fs.readFile(restarted.getDiaryPath(), 'utf8')
  expect(diary).not.toContain('generally prefers concise answers')
  expect(fixture.infer.mock.calls[1]?.[0].prompt).toContain(owner.interactionPreferences[0])
})

it.each([{}, { current_focus: null, working_theories: null }])('preserves hypotheses when reflection leaves their lists unchanged: %j', async (patch) => {
  const manager = new SelfModelManager()
  fixture.infer.mockResolvedValueOnce({ output: { current_focus: ['Verify sources.'], working_theories: ['Examples are useful.'] } })
  await manager.observeTurn(OBSERVATION)
  fixture.infer.mockResolvedValueOnce({ output: { ...patch, retrospection: 'I retained useful context.' } })
  await manager.observeTurn({ ...OBSERVATION, assistantMessage: 'I will keep this in mind.' })

  expect(manager.getSnapshot()).toContain('Verify sources.')
  expect(manager.getSnapshot()).toContain('Examples are useful.')
})

it.each([
  { current_focus: 'invalid', working_theories: [] },
  { working_theories: [null] },
  { current_focus: [], behavioral_principles: [{ text: 7 }] },
  '{"current_focus":[]',
  { unrelated: true }
])('rejects malformed reflection atomically without erasing learned state: %j', async (output) => {
  const manager = new SelfModelManager()
  fixture.infer.mockResolvedValueOnce({ output: { current_focus: ['Verify sources.'], working_theories: ['Examples are useful.'] } })
  await manager.observeTurn(OBSERVATION)
  fixture.infer.mockResolvedValueOnce({ output })
  await manager.observeTurn({ ...OBSERVATION, assistantMessage: 'Acknowledged.' })

  const restarted = new SelfModelManager()
  expect(restarted.getSnapshot()).toContain('Verify sources.')
  expect(restarted.getSnapshot()).toContain('Examples are useful.')
})

it('reports provider cutoff and applies complete reflection updates', async () => {
  const manager = new SelfModelManager()
  fixture.infer.mockResolvedValueOnce({
    output: '{"working_theories":["The owner prefers',
    finishReason: 'length',
    usedOutputTokens: 700
  })

  await manager.observeTurn(OBSERVATION)

  expect(manager.getSnapshot()).not.toContain('The owner prefers')
  expect(LogHelper.debug).toHaveBeenCalledWith(expect.stringContaining(
    'rejected invalid output | finishReason=length | outputTokens=700'
  ))

  fixture.infer.mockResolvedValueOnce({
    output: { working_theories: ['The owner prefers worked examples.'] },
    finishReason: 'stop',
    usedOutputTokens: 730
  })
  await manager.observeTurn({ ...OBSERVATION, assistantMessage: 'I will include worked examples.' })

  expect(new SelfModelManager().getSnapshot()).toContain('The owner prefers worked examples.')
  expect(LogHelper.debug).toHaveBeenCalledWith(expect.stringContaining(
    'accepted | finishReason=stop | outputTokens=730'
  ))
})
