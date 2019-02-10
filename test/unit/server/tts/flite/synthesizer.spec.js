'use strict'

import fs from 'fs'
import events from 'events'

import synthesizer from '@/tts/flite/synthesizer'

describe('Flite TTS synthesizer', () => {
  if (fs.existsSync(`${global.paths.root}/bin/flite/flite`)) {
    describe('init()', () => {
      test('returns true', () => {
        expect(synthesizer.init()).toBeTruthy()
      })

      test('returns warning message to say only "en-US" language is accepted', () => {
        process.env.LEON_LANG = 'fake-lang'
        console.warn = jest.fn()

        synthesizer.init()
        expect(console.warn).toBeCalled()
      })
    })

    describe('save()', () => {
      test('saves string to audio file', () => {
        const em = new events.EventEmitter()
        synthesizer.init()

        synthesizer.save('Hello world', em, (file) => {
          expect(fs.readFileSync(file)).toBeTruthy()
          fs.unlinkSync(file)
        })
      })

      test('get file duration', (done) => {
        const em = new events.EventEmitter()
        const spy = jest.spyOn(em, 'emit')

        synthesizer.save('Hello world', em, (file) => {
          expect(spy).toHaveBeenCalledTimes(1)
          expect(spy.mock.calls[0][0]).toBe('saved')
          expect(spy.mock.calls[0][1]).toBe(975)
          fs.unlinkSync(file)
          done()
        })
      })
    })
  }
})
