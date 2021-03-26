'use strict'

describe('cinema:cinema', async () => {
  test('[Feature] Recommend movie', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you recommend a movie ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['recommend-m'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] Recommend serie', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you recommend a serie ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['recommend-t'])
  })
})

describe('cinema:cinema', async () => {
  test('[Error management] Recommend failed error message', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you recommend a blublu ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['not_found'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] Request information about an movie', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you provide information about Captain Marvel ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['info-m'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] Request information about an serie or tv show', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you provide information about Big Bang Theory ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['info-t'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] Request information about an actor/realisator/productor', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you provide information about Tom Cruz ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['info-p'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] Request information about an collection of movie', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you provide information about Star Wars ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['info-c'])
  })
})

describe('cinema:cinema', async () => {
  test('[Error management] Info failed error message', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Can you provide information about blublu ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['not_found_title'])
  })
})

describe('cinema:cinema', async () => {
  test('[Feature] List of movies actually in theatres (internationnal box office)', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What movies are in theatres ?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['nit_list'])
  })
})
