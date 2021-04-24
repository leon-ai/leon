import os from '@/helpers/os'

describe('OS helper', () => {
  describe('get()', () => {
    test('returns information about the OS', () => {
      const info = os.get()

      expect(info.type).toBeOneOf(['windows', 'linux', 'macos'])
      expect(info.name).toBeOneOf(['Windows', 'Linux', 'macOS'])
    })

    test('returns information for Windows', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Windows_NT')

      expect(os.get()).toEqual({ name: 'Windows', type: 'windows' })
    })

    test('returns information for Linux', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Linux')

      expect(os.get()).toEqual({ name: 'Linux', type: 'linux' })
    })

    test('returns information for macOS', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Darwin')

      expect(os.get()).toEqual({ name: 'macOS', type: 'macos' })
    })
  })

  describe('cpus()', () => {
    test('returns the number of cores on the machine', () => {
      expect(os.cpus()).toBeArray()
      expect(os.cpus()[0]).toContainKeys(['model', 'speed', 'times'])
    })
  })
})
