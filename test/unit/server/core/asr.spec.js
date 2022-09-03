import fs from 'fs'

import Asr from '@/core/asr'
import Stt from '@/stt/stt'

describe('ASR', () => {
  afterAll(() => Stt.deleteAudios())

  describe('constructor()', () => {
    test('creates a new instance of Asr', () => {
      const asr = new Asr()

      expect(asr).toBeInstanceOf(Asr)
    })
  })

  describe('get audios()', () => {
    test('returns audio paths', () => {
      expect(Asr.audios).toContainAllKeys(['webm', 'wav'])
      expect(Asr.audios.webm.indexOf('/tmp/speech.webm')).not.toBe(-1)
      expect(Asr.audios.wav.indexOf('/tmp/speech.wav')).not.toBe(-1)
    })
  })

  describe('run()', () => {
    const webmTmp = Asr.audios.webm

    test('returns error because of wrong WebM audio path', async () => {
      const asr = new Asr()

      Asr.audios.webm = ''
      try {
        await asr.run('', {})
      } catch (e) {
        expect(e.type).toBe('error')
        Asr.audios.webm = webmTmp // Need to give back the real WebM path
      }
    })

    test('returns error because of a bad blob', async () => {
      const asr = new Asr()

      try {
        await asr.run('bad blob', {})
      } catch (e) {
        expect(e.type).toBe('error')
      }
    })

    test('returns warning speech recognition not ready', async () => {
      const asr = new Asr()
      const blob = Buffer.from(global.audio.base_64_webm_blob, 'base64')

      try {
        await asr.run(blob, {})
      } catch (e) {
        expect(e.type).toBe('warning')
      }
    })

    test('encodes audio blob to WAVE file', async () => {
      const asr = new Asr()
      const blob = Buffer.from(global.audio.base_64_webm_blob, 'base64')
      const stt = { parse: jest.fn() }

      await asr.run(blob, stt)
      expect(fs.existsSync(Asr.audios.webm)).toBe(true)
      expect(stt.parse).toHaveBeenCalledTimes(1)
    })
  })
})
