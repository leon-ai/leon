'use strict'

describe('videodownloader:youtube', async () => {
  test('requests YouTube', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Download new videos from YouTube')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.interOutput.codes).toIncludeSameMembers(['reaching_playlist'])
    expect([
      'settings_error',
      'request_error',
      'nothing_to_download',
      'success'
    ]).toIncludeAnyMembers(global.brain.finalOutput.codes)
  })
})
