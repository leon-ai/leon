import path from 'node:path'

import { beforeAll, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'

const coreMocks = vi.hoisted(() => ({
  brain: {
    skillFriendlyName: '',
    skillProcess: undefined as unknown,
    skillOutput: '',
    lang: 'en',
    isMuted: true,
    talk: vi.fn(),
    speakSkillError: vi.fn()
  },
  socket: {
    emit: vi.fn()
  },
  conversationLogger: {
    upsert: vi.fn(async () => undefined)
  },
  nlu: {
    nluProcessResult: {
      context: {
        data: {}
      }
    }
  }
}))

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/core', () => ({
  BRAIN: coreMocks.brain,
  SOCKET_SERVER: {
    socket: coreMocks.socket,
    emitToChatClients: coreMocks.socket.emit,
    emitAnswerToChatClients: coreMocks.socket.emit,
    clearLiveWidgets: vi.fn()
  },
  CONVERSATION_LOGGER: coreMocks.conversationLogger,
  NLU: coreMocks.nlu
}))

let LogicActionSkillHandler: typeof import('@/core/brain/logic-action-skill-handler').LogicActionSkillHandler

beforeAll(async () => {
  ;({ LogicActionSkillHandler } = await import(
    '@/core/brain/logic-action-skill-handler'
  ))
})

describe('controlled skill smoke', () => {
  it('runs a real controlled action skill and returns its answer', async () => {
    const skillConfigPath = path.join(
      process.cwd(),
      'skills',
      'native',
      'date_time_skill',
      'skill.json'
    )

    const result = await LogicActionSkillHandler.handle(
      {
        contextName: 'date_time',
        skillName: 'date_time_skill',
        actionName: 'current_time',
        skillConfigPath,
        skillConfig: {
          name: 'Date/Time',
          bridge: 'nodejs',
          version: '1.0.0',
          workflow: []
        },
        localeSkillConfig: {
          variables: {},
          widgetContents: {}
        },
        actionConfig: {
          type: 'logic',
          description: 'Tell the current time.',
          answers: {
            current_time: ['It is {{ hours }}:{{ minutes }}:{{ seconds }}.']
          }
        },
        new: {
          utterance: 'What time is it?',
          actionArguments: {},
          entities: [],
          sentiment: {}
        },
        context: {
          utterances: ['What time is it?'],
          actionArguments: [],
          entities: [],
          sentiments: [],
          data: {}
        }
      },
      `controlled-skill-smoke-${Date.now()}`
    )

    const answer = result.lastOutputFromSkill?.answer

    expect(typeof answer).toBe('string')
    expect(String(answer).startsWith('It is ')).toBe(true)
    expect(String(answer).includes(':')).toBe(true)
  })
})
