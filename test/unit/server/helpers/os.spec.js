import getos from 'getos'

jest.mock('getos')

// Import after mock, so we can change the OS
// eslint-disable-next-line
import os from '@/helpers/os'

const setupTest = (osName) => {
  getos.mockImplementation((cb) => cb(null, { os: osName, dist: osName === 'Linux' ? 'Arch' : undefined }))
}

describe('OS helper', () => {
  describe('get()', () => {
    test('returns information about the OS', async () => {
      const info = await os.get()

      expect(info.type).toBeOneOf(['windows', 'linux', 'macos'])
      expect(info.name).toBeOneOf(['Windows', 'Linux', 'macOS'])
    })

    test('returns information for Windows', async () => {
      setupTest('Windows')

      expect(await os.get()).toEqual({ name: 'Windows', type: 'windows' })
    })

    test('returns information for Linux', async () => {
      setupTest('Linux')

      expect(await os.get()).toEqual({ name: 'Linux', type: 'linux', distro: 'Arch' })
    })

    test('returns information for macOS', async () => {
      setupTest('Darwin')

      expect(await os.get()).toEqual({ name: 'macOS', type: 'macos' })
    })
  })

  describe('cpus()', () => {
    test('returns the number of cores on the machine', () => {
      expect(os.cpus()).toBeArray()
      expect(os.cpus()[0]).toContainKeys(['model', 'speed', 'times'])
    })
  })
})
