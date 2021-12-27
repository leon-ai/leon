describe('checker:haveibeenpwned', () => {
  test('checks if an email address has been provided', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Have I been pwned?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['no-email'])
  })
})
