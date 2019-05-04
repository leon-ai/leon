'use strict'

describe('calendar:todolist', async () => {
  test('creates a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Create the fake list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['list_created'])
  })
})
