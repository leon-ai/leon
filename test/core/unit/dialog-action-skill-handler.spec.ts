import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NLUProcessResult } from '@/core/nlp/types'

const brainMocks = vi.hoisted(() => ({
  talk: vi.fn()
}))

vi.mock('@/core', () => ({
  BRAIN: {
    isMuted: true,
    lang: 'en',
    talk: brainMocks.talk
  }
}))

import { DialogActionSkillHandler } from '@/core/brain/dialog-action-skill-handler'

function createProcessResult(
  answers: string[],
  actionArguments: Record<string, unknown>,
  variables: Record<string, string> = {}
): NLUProcessResult {
  return {
    actionName: 'schedule_meeting',
    skillName: 'calendar_skill',
    actionConfig: { answers },
    localeSkillConfig: { variables },
    context: {
      utterances: [],
      actionArguments: [actionArguments],
      entities: [],
      sentiments: [],
      data: {}
    }
  } as unknown as NLUProcessResult
}

describe('DialogActionSkillHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects only answers whose dynamic arguments are available', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const result = await DialogActionSkillHandler.handle(
      createProcessResult(
        [
          'Meeting scheduled for {{ date }}.',
          'Meeting moved by {{ offset }} minutes.',
          'Calendar updated.'
        ],
        { offset: 10 }
      ),
      'utterance-1'
    )

    expect(result.lastOutputFromSkill?.answer).toBe(
      'Meeting moved by 10 minutes.'
    )
  })

  it('keeps parameter-free variants eligible for natural variation', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const result = await DialogActionSkillHandler.handle(
      createProcessResult(
        [
          'Meeting scheduled for {{ date }}.',
          'Meeting moved by {{ offset }} minutes.',
          'Calendar updated.'
        ],
        { date: 'Monday' }
      ),
      'utterance-2'
    )

    expect(result.lastOutputFromSkill?.answer).toBe('Calendar updated.')
  })

  it('maps locale variables before dynamic action arguments', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const result = await DialogActionSkillHandler.handle(
      createProcessResult(
        ['{{ acknowledgement }}, the meeting is set for {{ date }}.', 'Done.', 'All set.'],
        { date: 'Tuesday' },
        { acknowledgement: 'Sure' }
      ),
      'utterance-3'
    )

    expect(result.lastOutputFromSkill?.answer).toBe(
      'Sure, the meeting is set for Tuesday.'
    )
  })
})
