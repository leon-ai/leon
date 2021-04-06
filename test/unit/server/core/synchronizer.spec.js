import Synchronizer from '@/core/synchronizer'

describe('synchronizer', () => {
  describe('constructor()', () => {
    test('creates a new instance of Synchronizer', () => {
      const sync = new Synchronizer({ }, { }, { })

      expect(sync).toBeInstanceOf(Synchronizer)
    })
  })

  describe('synchronize()', () => {
    test('executes direct synchronization method', () => {
      const brain = { socket: { } }
      brain.talk = brain.socket.emit = brain.wernicke = jest.fn()
      const sync = new Synchronizer(brain, { }, { method: 'direct' })
      sync.direct = jest.fn()

      sync.synchronize(() => {
        expect(sync.direct).toHaveBeenCalledTimes(1)
      })
    })

    test('executes Google Drive synchronization method', () => {
      const brain = { socket: { } }
      brain.talk = brain.socket.emit = brain.wernicke = jest.fn()
      const sync = new Synchronizer(brain, { }, { method: 'google-drive' })
      sync.googleDrive = jest.fn()

      sync.synchronize(() => {
        expect(sync.googleDrive).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('direct()', () => {
    test('emits the download', () => {
      const brain = { socket: { emit: jest.fn() } }
      const sync = new Synchronizer(brain, { }, { })

      sync.direct()
      expect(sync.brain.socket.emit.mock.calls[0][0]).toBe('download')
    })
  })
})
