'use strict'

describe('leon:age', async () => {
  test('tells its age', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('How old are you?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['age'])
  })
})
