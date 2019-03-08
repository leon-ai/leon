'use strict'

describe('dateandtime:saycurrenttime', async () => {
  test('detects valid date', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('what time is it?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('time')
  })
})
