import { LOG } from '@/helpers/log'

describe('log helper', () => {
  describe('success()', () => {
    test('logs success', () => {
      console.log = jest.fn()
      LOG.success('This is a success')
      expect(console.log.mock.calls[0][1]).toBe('This is a success')
    })
  })

  describe('info()', () => {
    test('logs info', () => {
      console.info = jest.fn()
      LOG.info('This is an info')
      expect(console.info.mock.calls[0][1]).toBe('This is an info')
    })
  })

  describe('error()', () => {
    test('logs error', () => {
      console.error = jest.fn()
      LOG.error('This is an error')
      expect(console.error.mock.calls[0][1]).toBe('This is an error')
    })
  })

  describe('warning()', () => {
    test('logs warning', () => {
      console.warn = jest.fn()
      LOG.warning('This is a warning')
      expect(console.warn.mock.calls[0][1]).toBe('This is a warning')
    })
  })

  describe('title()', () => {
    test('logs title', () => {
      console.log = jest.fn()
      LOG.title('This is a title')
      expect(console.log.mock.calls[0][1]).toBe('THIS IS A TITLE')
    })
  })

  describe('default()', () => {
    test('logs default', () => {
      console.log = jest.fn()
      LOG.default('This is a default')
      expect(console.log.mock.calls[0][1]).toBe('This is a default')
    })
  })
})
