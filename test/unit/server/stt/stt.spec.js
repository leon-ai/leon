import Stt from '@/stt/stt'

describe('STT', () => {
  describe('constructor()', () => {
    test('creates a new instance of Stt', () => {
      const stt = new Stt({}, 'coqui-stt')

      expect(stt).toBeInstanceOf(Stt)
    })
  })

  describe('init()', () => {
    test('returns error provider does not exist or not yet supported', () => {
      const stt = new Stt({}, 'fake-provider')

      expect(stt.init()).toBeFalsy()
    })

    test('initializes the STT parser', () => {
      const stt = new Stt({}, 'coqui-stt')

      expect(stt.init(() => null)).toBeTruthy()
    })
  })

  describe('forward()', () => {
    test('forwards string output to the client', () => {
      const stt = new Stt({}, '')
      stt.socket = { emit: jest.fn() }

      stt.forward('Hello')
      expect(stt.socket.emit.mock.calls[0][0]).toBe('recognized')
      expect(stt.socket.emit.mock.calls[0][1]).toBe('Hello')
    })
  })

  describe('parse()', () => {
    test('returns error file does not exist', () => {
      const stt = new Stt({}, '')

      expect(stt.parse('fake-file.wav')).toBeFalsy()
    })

    test('parses WAVE file via the chosen parser', () => {
      const stt = new Stt({}, '')

      expect(stt.parse(global.paths.wave_speech)).toBeTruthy()
    })
  })
})
