import Nlu from '@/core/nlu'

describe('NLU', () => {
  describe('constructor()', () => {
    test('creates a new instance of Nlu', () => {
      const nlu = new Nlu()

      expect(nlu).toBeInstanceOf(Nlu)
    })
  })

  describe('loadModel()', () => {
    test('returns warning NLP model does not exist', async () => {
      const nlu = new Nlu()

      try {
        await nlu.loadModel('ghost-model.nlp')
      } catch (e) {
        expect(e.type).toBe('warning')
      }
    })

    test('rejects because of a broken NLP model', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      try {
        await nlu.loadModel(global.paths.broken_nlp_model)
      } catch (e) {
        expect(e.type).toBe('error')
      }
    })

    test('loads the NLP model', async () => {
      const nlu = new Nlu()

      await nlu.loadModel(global.paths.nlp_model)
      expect(nlu.nlp.nluManager.domainManagers).not.toBeEmpty()
    })
  })

  describe('process()', () => {
    const nluFallbackTmp = Nlu.fallback

    test('rejects because the NLP model is empty', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      await expect(nlu.process('Hello')).rejects.toEqual('The NLP model is missing, please rebuild the project or if you are in dev run: npm run train')
    })

    test('resolves with intent not found', async () => {
      const nlu = new Nlu()
      nlu.brain = { talk: jest.fn(), wernicke: jest.fn(), socket: { emit: jest.fn() } }

      await nlu.loadModel(global.paths.nlp_model)
      await expect(nlu.process('Unknown intent')).resolves.toHaveProperty('message', 'Intent not found')
      expect(nlu.brain.talk).toHaveBeenCalledTimes(1)
    })

    test('executes brain with the fallback value (object)', async () => {
      const utterance = 'Thisisanutteranceexampletotestfallbacks'
      const fallbackObj = {
        utterance,
        entities: [],
        classification: { package: 'leon', module: 'randomnumber', action: 'run' }
      }
      const nlu = new Nlu()
      nlu.brain = { execute: jest.fn() }
      Nlu.fallback = jest.fn(() => fallbackObj)

      await nlu.loadModel(global.paths.nlp_model)

      await expect(nlu.process(utterance)).resolves.toHaveProperty('processingTime')
      expect(nlu.brain.execute.mock.calls[0][0]).toBe(fallbackObj)
      Nlu.fallback = nluFallbackTmp // Need to give back the real fallback method
    })

    test('returns true thanks to intent found', async () => {
      const nlu = new Nlu()
      nlu.brain = { execute: jest.fn() }

      await nlu.loadModel(global.paths.nlp_model)
      await expect(nlu.process('Hello')).toResolve()
      expect(nlu.brain.execute).toHaveBeenCalledTimes(1)
    })
  })

  describe('fallback()', () => {
    test('returns false because there is no fallback matching the utterance', () => {
      expect(Nlu.fallback({ utterance: 'This is an utterance example to test fallbacks' }, [])).toBeFalsy()
    })

    test('returns fallback injected object', () => {
      const obj = {
        utterance: 'This is am utterance example to test fallbacks',
        classification: { }
      }

      expect(Nlu.fallback(obj, [
        {
          words: ['utterance', 'example', 'test', 'fallbacks'], package: 'fake-pkg', module: 'fake-module', action: 'fake-action'
        }
      ]).classification).toContainEntries([['package', 'fake-pkg'], ['module', 'fake-module'], ['action', 'fake-action'], ['confidence', 1]])
    })
  })
})
