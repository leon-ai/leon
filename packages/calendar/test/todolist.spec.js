'use strict'

import path from 'path'
import fs from 'fs'

describe('calendar:todolist', async () => {
  // Once the tests are done, delete test DB file if it exists
  afterAll(() => {
    const pkgName = 'calendar'
    const dbFile = path.join(__dirname, `../data/db/${pkgName}.spec.json`)

    if (fs.existsSync(dbFile)) {
      fs.unlinkSync(dbFile)
    }
  })

  test('no list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Show all my lists')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['no_list'])
  })

  test('adds 3 todos and create a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Add 7 potatoes, 1kg of rice, bread to the shopping list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(3)
    expect(global.brain.finalOutput.speech.indexOf('"shopping" list')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['todos_added'])
  })

  test('completes a todo', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Complete rice from my shopping list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(1)
    expect(global.brain.finalOutput.speech.indexOf('"shopping" list')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.indexOf('<strike>1kg of rice</strike>')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['todos_completed'])
  })

  test('views a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('What is in my shopping list?')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.interOutput.codes).toIncludeSameMembers(['unchecked_todos_listed'])
    expect(global.brain.interOutput.speech.split('</li>').length - 1).toBe(2)
    expect(global.brain.interOutput.speech.indexOf('"shopping" list')).not.toBe(-1)
    expect(global.brain.interOutput.speech.indexOf('7 potatoes')).not.toBe(-1)
    expect(global.brain.interOutput.speech.indexOf('bread')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(1)
    expect(global.brain.finalOutput.speech.indexOf('"shopping" list')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.indexOf('<strike>1kg of rice</strike>')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers([
      'unchecked_todos_listed',
      'completed_todos_listed'
    ])
  })

  test('creates a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Create the movies list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.indexOf('"movies" list')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['list_created'])
  })

  test('renames a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Rename the movies list to cinema')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.indexOf('"movies" list')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.indexOf('to "cinema"')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['list_renamed'])
  })

  test('unchecks a todo', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Uncheck rice from the shopping list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(1)
    expect(global.brain.finalOutput.speech.indexOf('"shopping" list')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.indexOf('1kg of rice')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['todo_unchecked'])
  })

  test('deletes a list', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Delete the cinema list')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.indexOf('"cinema" list')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['list_deleted'])
  })

  test('views all lists', async () => {
    global.nlu.brain.execute = jest.fn()
    await global.nlu.process('Show all my lists')

    const [obj] = global.nlu.brain.execute.mock.calls
    await global.brain.execute(obj[0])

    expect(global.brain.finalOutput.speech.split('</li>').length - 1).toBe(1)
    expect(global.brain.finalOutput.speech.indexOf('"shopping"')).not.toBe(-1)
    expect(global.brain.finalOutput.speech.indexOf('3')).not.toBe(-1)
    expect(global.brain.finalOutput.codes).toIncludeSameMembers(['lists_listed'])
  })
})
