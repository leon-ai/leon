import { OSHelper } from '@/helpers/os-helper'

describe('OS helper', () => {
  describe('get()', () => {
    test('returns information about the OS', () => {
      const info = OSHelper.getInformation()

      expect(info.type).toBeOneOf(['windows', 'linux', 'macos'])
      expect(info.name).toBeOneOf(['Windows', 'Linux', 'macOS'])
    })

    test('returns information for Windows', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Windows_NT')

      expect(OSHelper.getInformation()).toEqual({
        name: 'Windows',
        type: 'windows'
      })
    })

    test('returns information for Linux', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Linux')

      expect(OSHelper.getInformation()).toEqual({
        name: 'Linux',
        type: 'linux'
      })
    })

    test('returns information for macOS', () => {
      jest.unmock('os')
      const o = jest.requireActual('os')
      o.type = jest.fn(() => 'Darwin')

      expect(OSHelper.getInformation()).toEqual({
        name: 'macOS',
        type: 'macos'
      })
    })
  })

  describe('cpus()', () => {
    test('returns the number of cores on the machine', () => {
      expect(typeof OSHelper.getNumberOfCPUCores()).toBe('number')
    })
  })
})
