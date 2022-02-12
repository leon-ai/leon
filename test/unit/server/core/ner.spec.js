import path from 'path'

import Ner from '@/core/ner'

describe('NER', () => {
  describe('constructor()', () => {
    test('creates a new instance of Ner', () => {
      const ner = new Ner()

      expect(ner).toBeInstanceOf(Ner)
    })
  })

  describe('logExtraction()', () => {
    test('logs entities extractions', async () => {
      console.log = jest.fn()

      Ner.logExtraction([
        { sourceText: 'shopping', entity: 'list' },
        { sourceText: 'red', entity: 'color' }
      ])

      expect(console.log.mock.calls[0][1]).toBe('{ value: shopping, entity: list }')
      expect(console.log.mock.calls[1][1]).toBe('{ value: red, entity: color }')
    })
  })

  describe('extractEntities()', () => {
    test('finds no entity', async () => {
      const ner = new Ner()

      const entities = await ner.extractEntities(
        'en',
        path.join(__dirname, '../../../../packages/leon/data/expressions/en.json'),
        {
          utterance: 'Give me a random number',
          entities: [],
          classification: {
            package: 'leon',
            module: 'randomnumber',
            action: 'run',
            confidence: 1
          }
        }
      )

      expect(entities).toEqual([])
    })

    test('extracts built-in entities', async () => {
      const ner = new Ner()
      Ner.logExtraction = jest.fn()

      const entities = await ner.extractEntities(
        'en',
        path.join(__dirname, '../../../../packages/trend/data/expressions/en.json'),
        {
          utterance: 'Give me the 2 latest GitHub trends',
          entities: [{ sourceText: 2, entity: 'number' }],
          classification: {
            package: 'trend',
            module: 'github',
            action: 'run',
            confidence: 1
          }
        }
      )

      expect(Ner.logExtraction).toHaveBeenCalledTimes(1)
      expect(entities.length).toBe(1)
    })

    test('does not support entity type', async () => {
      const ner = new Ner()

      try {
        await ner.extractEntities(
          'en',
          global.paths.utterance_samples,
          {
            utterance: 'Just an utterance',
            entities: [],
            classification: {
              package: 'doesnotmatter',
              module: 'unittest',
              action: 'do_not_support_entity',
              confidence: 1
            }
          }
        )
      } catch (e) {
        expect(e.code).toBe('random_ner_type_not_supported')
      }
    })

    test('extracts trim custom entities with between conditions', async () => {
      const ner = new Ner()
      Ner.logExtraction = jest.fn()

      const entities = await ner.extractEntities(
        'en',
        path.join(__dirname, '../../../../packages/calendar/data/expressions/en.json'),
        {
          utterance: 'Create a shopping list',
          entities: [],
          classification: {
            package: 'calendar',
            module: 'todolist',
            action: 'create_list',
            confidence: 1
          }
        }
      )

      expect(Ner.logExtraction).toHaveBeenCalledTimes(1)
      expect(entities.length).toBe(1)
      expect(entities[0].entity).toBe('list')
      expect(entities[0].sourceText).toBe('shopping')
    })

    test('extracts trim custom entities with before and after conditions', async () => {
      const ner = new Ner()
      Ner.logExtraction = jest.fn()

      const entities = await ner.extractEntities(
        'en',
        global.paths.utterance_samples,
        {
          utterance: 'Please whistle as a bird',
          entities: [],
          classification: {
            package: 'doesnotmatter',
            module: 'mockingbird',
            action: 'test',
            confidence: 1
          }
        }
      )

      expect(Ner.logExtraction).toHaveBeenCalledTimes(1)
      expect(entities.length).toBe(2)
      expect(entities.map((e) => e.entity)).toEqual(['start', 'animal'])
      expect(entities.map((e) => e.sourceText)).toEqual(['Please whistle as a', 'bird'])
    })

    test('extracts regex custom entities', async () => {
      const ner = new Ner()
      Ner.logExtraction = jest.fn()

      const entities = await ner.extractEntities(
        'en',
        global.paths.utterance_samples,
        {
          utterance: 'I love the color blue, white and red',
          entities: [],
          classification: {
            package: 'preference',
            module: 'color',
            action: 'run',
            confidence: 1
          }
        }
      )

      expect(Ner.logExtraction).toHaveBeenCalledTimes(1)
      expect(entities.length).toBe(3)
      expect(entities.map((e) => e.entity)).toEqual(['color', 'color', 'color'])
      expect(entities.map((e) => e.sourceText)).toEqual(['blue', 'white', 'red'])
    })
  })
})
