'use strict'

describe('leon:bye', async () => {
  test('says bye', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Bye bye')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['good_bye'])
  })
})
