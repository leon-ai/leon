'use strict'

describe('leon:joke', async () => {
  test('tells a joke', async () => {
    global.nlu.brain.execute = jest.fn()
    global.nlu.process('Tell me a joke')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.code).toBe('jokes')
  })
})
