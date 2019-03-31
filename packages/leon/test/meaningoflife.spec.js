'use strict'

describe('leon:meaningoflife', async () => {
  test('says the meaning of life', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What is the meaning of life?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['meaning_of_life'])
  })
})
