'use strict'

describe('leon:randomnumber', async () => {
  test('gives a random number between 0 and 100', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me a random number')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['success'])
    expect(parseInt(global.brain.finalOutput.speech, 10)).toBeGreaterThanOrEqual(0)
    expect(parseInt(global.brain.finalOutput.speech, 10)).toBeLessThanOrEqual(100)
  })
})
