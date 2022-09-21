import { OS } from '@/helpers/os'

describe('OS helper', () => {
  describe('get()', () => {
    test('returns information about the OS', () => {
      const info = OS.getInformation()

      expect(info.type).toBeOneOf(['windows', 'linux', 'macos'])
      expect(info.name).toBeOneOf(['Windows', 'Linux', 'macOS'])
    })

    test('returns information for Windows', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Windows_NT')

      expect(OS.getInformation()).toEqual({ name: 'Windows', type: 'windows' })
    })

    test('returns information for Linux', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Linux')

      expect(OS.getInformation()).toEqual({ name: 'Linux', type: 'linux' })
    })

    test('returns information for macOS', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Darwin')

      expect(OS.getInformation()).toEqual({ name: 'macOS', type: 'macos' })
    })
  })

  describe('cpus()', () => {
    test('returns the number of cores on the machine', () => {
      expect(typeof OS.getNumberOfCPUCores()).toBe('number')
    })
  })
})
