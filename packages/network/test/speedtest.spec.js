describe('network:speedtest', () => {
  test('does a speed test', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Do a speed test')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(3)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['testing', 'done'])
  })
})
