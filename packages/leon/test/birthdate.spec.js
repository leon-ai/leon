'use strict'

describe('leon:birthdate', async () => {
  test('says when it was created', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('When were you born?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['date'])
  })

  test('says when is is\'s next birthday', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('When is your birthday?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['birthday'])
  })
})
