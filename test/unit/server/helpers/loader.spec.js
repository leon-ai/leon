import loader from '@/helpers/loader'

jest.useFakeTimers()

describe('loader helper', () => {
  describe('start()', () => {
    jest.useFakeTimers()
    jest.spyOn(global, 'setInterval')

    test('starts spinner', () => {
      expect(loader.start()).toBeObject()
      expect(setInterval).toHaveBeenCalledTimes(1)
    })
  })

  describe('stop()', () => {
    test('stops spinner', () => {
      expect(loader.stop()).toBeObject()
    })
  })
})
