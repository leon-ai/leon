import { LoaderHelper } from '@/helpers/loader-helper'

jest.useFakeTimers()

describe('loader helper', () => {
  describe('start()', () => {
    jest.useFakeTimers()
    jest.spyOn(global, 'setInterval')

    test('starts spinner', () => {
      expect(LoaderHelper.start()).toBeObject()
      expect(setInterval).toHaveBeenCalledTimes(1)
    })
  })

  describe('stop()', () => {
    test('stops spinner', () => {
      expect(LoaderHelper.stop()).toBeObject()
    })
  })
})
