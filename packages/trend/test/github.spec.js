'use strict'

describe('trend:github', async () => {
  test('forces limit', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the 30 latest GitHub trends')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(25)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'limit_max',
      'reaching',
      'today'
    ])
  })

  test('gives the 16 trends', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the 16 latest GitHub trends')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(16)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'today'
    ])
  })

  test('gives the default number of trends of this week', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the GitHub trends of this week')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(5)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'week'
    ])
  })

  test('gives the default number of trends of this month', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the GitHub trends of this month')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(5)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'month'
    ])
  })

  test('gives the 7 trends for the Python language', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the 7 GitHub trends for the Python language')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(7)
    expect(global.brain.finalOutput.speech.indexOf('Python')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'today_with_tech'
    ])
  })

  test('gives the 14 trends of this week for the JavaScript language', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the 14 GitHub trends of this week for the JavaScript language')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(14)
    expect(global.brain.finalOutput.speech.indexOf('JavaScript')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'week_with_tech'
    ])
  })

  test('gives the default number of trends of this month for the CSS language', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Give me the GitHub trends of this month for the CSS language')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(5)
    expect(global.brain.finalOutput.speech.indexOf('CSS')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'reaching',
      'month_with_tech'
    ])
  })
})
