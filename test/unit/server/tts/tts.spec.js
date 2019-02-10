'use strict'

import Tts from '@/tts/tts'

describe('TTS', () => {
  describe('constructor()', () => {
    test('creates a new instance of tts', () => {
      const tts = new Tts({ }, 'flite')

      expect(tts).toBeInstanceOf(Tts)
    })
  })

  describe('init()', () => {
    test('returns error provider does not exist or not yet supported', () => {
      const tts = new Tts({ }, 'fake-provider')

      expect(tts.init()).toBeFalsy()
    })

    test('initializes the TTS synthesizer', () => {
      const tts = new Tts({ }, 'flite')

      expect(tts.init()).toBeTruthy()
    })
  })

  describe('forward()', () => {
    test('forwards buffer audio file to the client', () => {
      const tts = new Tts({ }, '')
      tts.synthesizer = { default: { save: jest.fn() } }
      tts.socket = { emit: jest.fn() }

      tts.forward('Hello')
      expect(tts.synthesizer.default.save.mock.calls[0][0]).toBe('Hello')
    })
  })

  describe('onSaved()', () => {
    test('shifts the queue', async () => {
      const tts = new Tts({ }, 'flite')
      tts.forward = jest.fn()

      tts.speeches.push('Hello', 'Hello again')
      setTimeout(() => {
        tts.em.emit('saved', 300)
      }, 300)

      expect(tts.speeches.length).toBe(2)
      await tts.onSaved()
      expect(tts.forward).toHaveBeenCalledTimes(1)
      expect(tts.speeches.length).toBe(1)
    })
  })

  describe('add()', () => {
    test('fixes Flite ', async () => {
      const tts = new Tts({ }, 'flite')
      tts.forward = jest.fn()

      expect(tts.add('Hello')[0].substr('Hello'.length)).toBe(' ')
    })

    test('adds speech to the queue ', async () => {
      const tts = new Tts({ }, 'flite')
      tts.forward = jest.fn()

      tts.speeches.push('Hello')
      expect(tts.add('Hello again').length).toBe(2)
    })

    test('forwards speech latest speech', async () => {
      const tts = new Tts({ }, 'flite')
      tts.forward = jest.fn()

      tts.add('Hello')
      expect(tts.forward).toHaveBeenCalledTimes(1)
    })
  })
})
