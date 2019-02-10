'use strict'

import fs from 'fs'

import parser from '@/stt/deepspeech/parser'

describe('DeepSpeech STT parser', () => {
  // Only run these tests if the models exist
  if (fs.existsSync(`${global.paths.root}/bin/deepspeech/output_graph.pb`) &&
    fs.existsSync(`${global.paths.root}/bin/deepspeech/alphabet.txt`) &&
    fs.existsSync(`${global.paths.root}/bin/deepspeech/lm.binary`) &&
    fs.existsSync(`${global.paths.root}/bin/deepspeech/trie`)) {
    describe('init()', () => {
      test('returns error cannot find model', () => {
        expect(parser.init({
          model: 'fake-model-path'
        })).toBeFalsy()
      })

      test('returns error cannot find alphabet', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/output_graph.pb`,
          alphabet: 'fake-alphabet-path'
        })).toBeFalsy()
      })

      test('returns error cannot find language model', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/output_graph.pb`,
          alphabet: `${global.paths.root}/bin/deepspeech/alphabet.txt`,
          lm: 'fake-lm-path',
          trie: 'fake-trie-path'
        })).toBeFalsy()
      })

      test('returns error cannot find trie', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/output_graph.pb`,
          alphabet: `${global.paths.root}/bin/deepspeech/alphabet.txt`,
          lm: `${global.paths.root}/bin/deepspeech/lm.binary`,
          trie: 'fake-trie-path'
        })).toBeFalsy()
      })

      test('returns true because all of the paths are good', () => {
        expect(parser.init({
          model: `${global.paths.root}/bin/deepspeech/output_graph.pb`,
          alphabet: `${global.paths.root}/bin/deepspeech/alphabet.txt`,
          lm: `${global.paths.root}/bin/deepspeech/lm.binary`,
          trie: `${global.paths.root}/bin/deepspeech/trie`
        })).toBeTruthy()
      })
    })
  }

  describe('parser()', () => {
    test('returns error because the sample rate is not 16 kHz', () => {
      expect(parser.parse(fs.readFileSync(`${global.paths.wave_speech_8}`))).toBeFalsy()
    })

    test('returns true', () => {
      expect(parser.parse(fs.readFileSync(`${global.paths.wave_speech}`))).toBeTruthy()
    })
  })
})
