'use strict'

describe('leon:greeting', async () => {
  test('greets', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Hello')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect([
      'morning_good_day',
      'morning',
      'afternoon',
      'evening',
      'night',
      'too_late',
      'default'
    ]).toIncludeAnyMembers(global.brain.finalOutput.codes)
  })
})
