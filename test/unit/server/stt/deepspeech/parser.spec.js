import fs from 'fs'

import parser from '@/stt/deepspeech/parser'

describe('DeepSpeech STT parser', () => {
  // Only run these tests if the models exist
  if (fs.existsSync(`${global.paths.root}/bin/deepspeech/deepspeech.pbmm`)
    && fs.existsSync(`${global.paths.root}/bin/deepspeech/deepspeech.scorer`)) {
    describe('init()', () => {
      test('returns error cannot find model', () => {
        expect(parser.init({
          model: 'fake-model-path'
        })).toBeFalsy()
      })

      test('returns error cannot find scorer', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/deepspeech.pbmm`,
          scorer: 'fake-scorer-path'
        })).toBeFalsy()
      })

      test('returns true because all of the paths are good', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/deepspeech.pbmm`,
          scorer: `${global.paths.root}/bin/deepspeech/deepspeech.scorer`
        })).toBeTruthy()
      })
    })
  }

  describe('parser()', () => {
    test('displays warning because the sample rate is lower than the desired sample rate', () => {
      console.warn = jest.fn()

      parser.parse(fs.readFileSync(`${global.paths.wave_speech_8}`))
      expect(console.warn).toBeCalled()
    })

    test('returns true', () => {
      expect(parser.parse(fs.readFileSync(`${global.paths.wave_speech}`))).toBeTruthy()
    })
  })
})
