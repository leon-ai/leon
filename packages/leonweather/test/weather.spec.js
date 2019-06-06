'use strict'

describe('leonweather:weather', async () => {
  test('Check the weather today', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What\'s the weather in Paris ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['weather_t'])
  })

  test('Check the weather in future', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What\'s the weather in Paris tomorrow ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['weather_f'])
  })

  test('Error', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What\'s the weather in Vide0 ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['error'])
  })

  test('The city does not exist', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What\'s the weather in Blublu ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['404_city_not_found'])
  })
})
