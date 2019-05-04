'use strict'

import Nlu from '@/core/nlu'

describe('NLU', () => {
  describe('constructor()', () => {
    test('creates a new instance of Nlu', () => {
      const nlu = new Nlu()

      expect(nlu).toBeInstanceOf(Nlu)
    })
  })

  describe('loadModel()', () => {
    test('returns warning classifier does not exist', async () => {
      const nlu = new Nlu()

      try {
        await nlu.loadModel('ghost-classifier.json')
      } catch (e) {
        expect(e.type).toBe('warning')
      }
    })

    test('rejects because of a broken classifier', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      try {
        await nlu.loadModel(global.paths.broken_classifier)
      } catch (e) {
        expect(e.type).toBe('error')
      }
    })

    test('loads the classifier', async () => {
      const nlu = new Nlu()

      await nlu.loadModel(global.paths.classifier)
      expect(nlu.classifier).not.toBeEmpty()
    })
  })

  describe('process()', () => {
    const nluFallbackTmp = Nlu.fallback

    test('returns false because the classifier is empty', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      expect(await nlu.process('Hello')).toBeFalsy()
    })

    test('returns false because of query not found', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      await nlu.loadModel(global.paths.classifier)
      expect(await nlu.process('Unknown query')).toBeFalsy()
      expect(nlu.brain.talk).toHaveBeenCalledTimes(1)
    })

    test('executes brain with the fallback value (object)', async () => {
      const fallbackObj = { foo: 'bar' }
      const nlu = new Nlu()
      nlu.brain = { execute: jest.fn() }
      Nlu.fallback = jest.fn(() => fallbackObj)

      await nlu.loadModel(global.paths.classifier)
      expect(await nlu.process('Thisisaqueryexampletotestfallbacks')).toBeTruthy()
      expect(nlu.brain.execute.mock.calls[0][0]).toBe(fallbackObj)
      Nlu.fallback = nluFallbackTmp // Need to give back the real fallback method
    })

    test('returns true thanks to query found', async () => {
      const nlu = new Nlu()
      nlu.brain = { execute: jest.fn() }

      await nlu.loadModel(global.paths.classifier)
      expect(await nlu.process('Hello')).toBeTruthy()
      expect(nlu.brain.execute).toHaveBeenCalledTimes(1)
    })
  })

  describe('fallback()', () => {
    test('returns false because there is no fallback matching the query', () => {
      expect(Nlu.fallback({ query: 'This is a query example to test fallbacks' }, [])).toBeFalsy()
    })

    test('returns fallback injected object', () => {
      const obj = {
        query: 'This is a query example to test fallbacks',
        classification: { }
      }

      expect(Nlu.fallback(obj, [
        { words: ['query', 'example', 'test', 'fallbacks'], package: 'fake-pkg', module: 'fake-module', action: 'fake-action' }
      ]).classification).toContainEntries([['package', 'fake-pkg'], ['module', 'fake-module'], ['action', 'fake-action'], ['confidence', 1]])
    })
  })
})
