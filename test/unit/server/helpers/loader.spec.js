'use strict'

import loader from '@/helpers/loader'

jest.useFakeTimers()

describe('loader helper', () => {
  describe('start()', () => {
    test('starts spinner', () => {
      expect(loader.start()).toBeObject()
      jest.runTimersToTime(60000)
      expect(setInterval).toHaveBeenCalledTimes(2)
    })
  })

  describe('stop()', () => {
    test('stops spinner', () => {
      expect(loader.stop()).toBeObject()
    })
  })
})
