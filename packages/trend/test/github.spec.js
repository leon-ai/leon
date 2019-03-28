'use strict'

describe('trend:github', async () => {
  test('forces limit', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the 30 latest trends on GitHub')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    console.log(global.brain.finalOutput)

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(25)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'limit_max',
      'reaching',
      'done'
    ])
  })
})
