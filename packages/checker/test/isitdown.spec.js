'use strict'

describe('checker:isitdown', async () => {
  test('detects invalid domain name', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Check if github is up')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('invalid_domain_name')
  })

  test('detects down domain name', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Check if fakedomainnametotestleon.fr is up')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.interOutput.code).toBe('down')
    expect(global.brain.finalOutput.code).toBe('done')
  })

  test('detects up domain name', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Check if github.com is up')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.interOutput.code).toBe('up')
    expect(global.brain.finalOutput.code).toBe('done')
  })

  test('detects up domain names', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Check if github.com and nodejs.org are up')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.interOutput.code).toBe('up')
    expect(global.brain.finalOutput.code).toBe('done')
  })
})
