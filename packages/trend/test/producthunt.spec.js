'use strict'

describe('trend:producthunt', async () => {
  test('requests Product Hunt', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What\'s trending on Product Hunt?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect([
      'reaching',
      'today',
      'unreachable',
      'invalid_developer_token'
    ]).toIncludeAnyMembers(global.brain.finalOutput.codes)
  })
})
