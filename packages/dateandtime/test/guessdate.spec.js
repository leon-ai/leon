'use strict'

describe('dateandtime:guessdate', async () => {
  test('detects valid date guess', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('what day is today?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('guess')
  })
})
