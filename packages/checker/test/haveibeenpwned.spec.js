'use strict'

describe('checker:haveibeenpwned', async () => {
  test('checks that an email has been pwned', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Has iifeoluwa.ao@gmail.com been pwned?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['checking', 'no-pwnage'])
  })

  test('checks that multiple emails have been pwned', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Verify the pwnage status of iifeoluwa.ao@gmail.com and ifeoluwa1990@yahoo.com')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['checking', 'no-pwnage', 'pwned'])
  })
})
