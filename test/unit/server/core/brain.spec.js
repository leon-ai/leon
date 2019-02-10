'use strict'

import { spawn } from 'child_process'

import Brain from '@/core/brain'

describe('brain', () => {
  describe('constructor()', () => {
    test('creates a new instance of Brain', () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')

      expect(brain).toBeInstanceOf(Brain)
    })
  })

  describe('talk()', () => {
    test('does not emit answer to the client when the speech is empty', () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')

      brain.talk('')
      expect(brain.socket.emit).toHaveBeenCalledTimes(0)
    })

    test('emits string answer to the client', () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')
      brain.tts = { add: jest.fn() }

      brain.talk('Hello world')
      expect(brain.tts.add).toHaveBeenCalledTimes(1)
      expect(brain.socket.emit).toHaveBeenCalledTimes(1)
    })
  })

  describe('wernicke()', () => {
    test('picks specific string according to object properties', () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')

      expect(brain.wernicke('errors', 'not_found', { })).toBe('Sorry, it seems I cannot find that')
    })

    test('picks random string from an array', () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')

      expect(global.enExpressions.answers.random_errors).toIncludeAnyMembers([brain.wernicke('random_errors', '', { })])
    })
  })

  describe('execute()', () => {
    test('asks to repeat', async () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')
      brain.talk = jest.fn()

      await brain.execute({ classification: { confidence: 0.1 } })
      const [string] = brain.talk.mock.calls
      expect(global.enExpressions.answers.random_not_sure)
        .toIncludeAnyMembers([string[0].substr(0, (string[0].length - 1))])
    })

    test('creates child process', async () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')
      brain.tts = {
        synthesizer: jest.fn(),
        default: jest.fn(),
        save: jest.fn(),
        add: jest.fn()
      }

      const obj = {
        query: 'Hello',
        classification: {
          package: 'leon',
          module: 'greeting',
          confidence: 0.9
        }
      }

      await brain.execute(obj)

      expect(brain.process).toEqual({ })
    })

    test('executes module', async () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')
      brain.talk = jest.fn()

      const obj = {
        query: 'Is github.com up?',
        classification: {
          package: 'checker',
          module: 'isitdown',
          confidence: 0.9
        }
      }

      await brain.execute(obj)

      expect(brain.talk).toHaveBeenCalled()
    })

    test('rejects promise because of spawn failure', async () => {
      const brain = new Brain({ emit: jest.fn() }, 'en')
      brain.talk = jest.fn()

      const obj = {
        query: 'Hello',
        classification: {
          package: 'leon',
          module: 'greeting',
          confidence: 0.9
        }
      }

      brain.process = spawn('pipenv', ['run', 'python', `${global.paths.packages}/fake-main-to-test.py`, 'en',
        obj.classification.package, obj.classification.module, obj.query])

      try {
        await brain.execute(obj)
      } catch (e) {
        expect(e.type).toBe('error')
        expect(brain.talk).toHaveBeenCalledTimes(1)
      }
    })
  })
})
