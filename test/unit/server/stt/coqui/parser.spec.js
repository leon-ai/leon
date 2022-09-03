import fs from 'fs'

import parser from '@/stt/coqui-stt/parser'

describe('Coqui STT parser', () => {
  // Only run these tests if the models exist
  if (
    fs.existsSync(`${global.paths.root}/bin/coqui/model.tflite`) &&
    fs.existsSync(`${global.paths.root}/bin/coqui/huge-vocabulary.scorer`)
  ) {
    describe('init()', () => {
      test('returns error cannot find model', () => {
        expect(
          parser.init({
            model: 'fake-model-path'
          })
        ).toBeFalsy()
      })

      test('returns error cannot find scorer', () => {
        expect(
          parser.init({
            model: `${global.paths.root}/bin/coqui/model.tflite`,
            scorer: 'fake-scorer-path'
          })
        ).toBeFalsy()
      })

      test('returns true because all of the paths are good', () => {
        expect(
          parser.init({
            model: `${global.paths.root}/bin/coqui/model.tflite`,
            scorer: `${global.paths.root}/bin/coqui/huge-vocabulary.scorer`
          })
        ).toBeTruthy()
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
      expect(
        parser.parse(fs.readFileSync(`${global.paths.wave_speech}`))
      ).toBeTruthy()
    })
  })
})
