import { LOADER } from '@/helpers/loader'

jest.useFakeTimers()

describe('loader helper', () => {
  describe('start()', () => {
    jest.useFakeTimers()
    jest.spyOn(global, 'setInterval')

    test('starts spinner', () => {
      expect(LOADER.start()).toBeObject()
      expect(setInterval).toHaveBeenCalledTimes(1)
    })
  })

  describe('stop()', () => {
    test('stops spinner', () => {
      expect(LOADER.stop()).toBeObject()
    })
  })
})
