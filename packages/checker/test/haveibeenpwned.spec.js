'use strict'

describe('checker:haveibeenpwned', async () => {
  test('checks if an email address has been pwned', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Has supercleanemailaddress@supercleandomainname.com been pwned?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['checking', 'no-pwnage'])
  })

  test('checks if multiple email addresses have been pwned', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Verify the pwnage status of supercleanemailaddress@supercleandomainname.com and test@toto.com')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['checking', 'no-pwnage', 'pwned'])
  })
})
