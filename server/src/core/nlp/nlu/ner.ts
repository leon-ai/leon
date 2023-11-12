import type { ShortLanguageCode } from '@/types'
import type {
  BuiltInEntityType,
  NEREntity,
  NERSpacyEntity,
  NLPUtterance,
  NLUResult,
  SpacyEntityType
} from '@/core/nlp/types'
import { BUILT_IN_ENTITY_TYPES, SPACY_ENTITY_TYPES } from '@/core/nlp/types'
import type {
  SkillCustomEnumEntityTypeSchema,
  SkillCustomRegexEntityTypeSchema,
  SkillCustomTrimEntityTypeSchema
} from '@/schemas/skill-schemas'
import { BRAIN, MODEL_LOADER, TCP_CLIENT } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NERManager = undefined | any

// https://github.com/axa-group/nlp.js/blob/master/packages/builtin-microsoft/src/builtin-microsoft.js
export const MICROSOFT_BUILT_IN_ENTITIES = [
  'Number',
  'Ordinal',
  'Percentage',
  'Age',
  'Currency',
  'Dimension',
  'Temperature',
  'DateTime',
  'PhoneNumber',
  'IpAddress',
  // Disable booleans to handle it ourselves
  // 'Boolean',
  'Email',
  'Hashtag',
  'URL'
]

export default class NER {
  private static instance: NER
  public manager: NERManager
  public spacyData: Map<
    `${SpacyEntityType}-${string}`,
    Record<string, unknown>
  > = new Map()

  constructor() {
    if (!NER.instance) {
      LogHelper.title('NER')
      LogHelper.success('New instance')

      NER.instance = this
    }
  }

  private static logExtraction(entities: NEREntity[]): void {
    LogHelper.title('NER')
    LogHelper.success('Entities found:')

    entities.forEach((entity) =>
      LogHelper.success(
        `{ value: ${entity.sourceText}, entity: ${entity.entity} }`
      )
    )
  }

  /**
   * Grab entities and match them with the utterance
   */
  public extractEntities(
    lang: ShortLanguageCode,
    skillConfigPath: string,
    nluResult: NLUResult
  ): Promise<NEREntity[]> {
    return new Promise(async (resolve) => {
      LogHelper.title('NER')
      LogHelper.info('Looking for entities...')

      const { classification } = nluResult
      // Remove end-punctuation and add an end-whitespace
      const utterance = `${StringHelper.removeEndPunctuation(
        nluResult.utterance
      )} `
      const { actions } = await SkillDomainHelper.getSkillConfig(
        skillConfigPath,
        lang
      )
      const { action } = classification
      const promises: Array<Promise<void>> = []
      const actionEntities = actions[action]?.entities || []

      /**
       * Browse action entities
       * Dynamic injection of the action entities depending on the entity type
       */
      for (let i = 0; i < actionEntities.length; i += 1) {
        const entity = actionEntities[i]

        if (entity?.type === 'regex') {
          promises.push(this.injectRegexEntity(lang, entity))
        } else if (entity?.type === 'trim') {
          promises.push(this.injectTrimEntity(lang, entity))
        } else if (entity?.type === 'enum') {
          promises.push(this.injectEnumEntity(lang, entity))
        }
      }

      await Promise.all(promises)

      const { entities }: { entities: NEREntity[] } =
        await this.manager.process({
          locale: lang,
          text: utterance
        })

      // Normalize entities
      entities.map((entity) => {
        // Trim whitespace at the beginning and the end of the entity value
        entity.sourceText = entity.sourceText.trim()
        entity.utteranceText = entity.utteranceText.trim()

        // Add resolution property to stay consistent with all entities
        if (!entity.resolution) {
          entity.resolution = { value: entity.sourceText }
        }

        if (
          BUILT_IN_ENTITY_TYPES.includes(entity.entity as BuiltInEntityType)
        ) {
          entity.type = entity.entity as BuiltInEntityType
        }

        if (SPACY_ENTITY_TYPES.includes(entity.entity as SpacyEntityType)) {
          entity.type = entity.entity as SpacyEntityType
          if (
            'value' in entity.resolution &&
            this.spacyData.has(`${entity.type}-${entity.resolution.value}`)
          ) {
            entity.resolution = this.spacyData.get(
              `${entity.type}-${entity.resolution.value}`
            ) as NERSpacyEntity['resolution']
          }
        }

        return entity
      })

      if (entities.length > 0) {
        NER.logExtraction(entities)
        return resolve(entities)
      }

      LogHelper.title('NER')
      LogHelper.info('No entity found')
      return resolve([])
    })
  }

  /**
   * Merge spaCy entities with the NER instance
   */
  public async mergeSpacyEntities(utterance: NLPUtterance): Promise<void> {
    this.spacyData = new Map()
    const spacyEntities = await this.getSpacyEntities(utterance)

    if (spacyEntities.length > 0) {
      spacyEntities.forEach(({ entity, resolution }) => {
        const value = StringHelper.ucFirst(resolution.value)
        const spacyEntity = {
          [entity]: {
            options: {
              [resolution.value]: [value]
            }
          }
        }
        this.spacyData.set(`${entity}-${value}`, resolution)

        MODEL_LOADER.mainNLPContainer.addEntities(spacyEntity, BRAIN.lang)
      })
    }
  }

  /**
   * Get spaCy entities from the TCP server
   */
  private getSpacyEntities(utterance: NLPUtterance): Promise<NERSpacyEntity[]> {
    return new Promise((resolve) => {
      const spacyEntitiesReceivedHandler = async ({
        spacyEntities
      }: {
        spacyEntities: NERSpacyEntity[]
      }): Promise<void> => {
        resolve(spacyEntities)
      }

      TCP_CLIENT.ee.removeAllListeners()
      TCP_CLIENT.ee.on('spacy-entities-received', spacyEntitiesReceivedHandler)

      TCP_CLIENT.emit('get-spacy-entities', utterance)
    })
  }

  /**
   * Inject trim type entities
   */
  private injectTrimEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomTrimEntityTypeSchema
  ): Promise<void> {
    return new Promise((resolve) => {
      for (let j = 0; j < entityConfig.conditions.length; j += 1) {
        const condition = entityConfig.conditions[j]
        const conditionMethod = `add${StringHelper.snakeToPascalCase(
          condition?.type || ''
        )}Condition`

        if (condition?.type === 'between') {
          /**
           * Conditions: https://github.com/axa-group/nlp.js/blob/master/docs/v3/ner-manager.md#trim-named-entities
           * e.g. list.addBetweenCondition('en', 'list', 'create a', 'list')
           */
          this.manager[conditionMethod](
            lang,
            entityConfig.name,
            condition?.from,
            condition?.to
          )
        } else if (condition?.type.indexOf('after') !== -1) {
          const rule = {
            type: 'afterLast',
            words: condition?.from,
            options: {}
          }
          this.manager.addRule(lang, entityConfig.name, 'trim', rule)
          this.manager[conditionMethod](
            lang,
            entityConfig.name,
            condition?.from
          )
        } else if (condition.type.indexOf('before') !== -1) {
          this.manager[conditionMethod](lang, entityConfig.name, condition.to)
        }
      }

      resolve()
    })
  }

  /**
   * Inject regex type entities
   */
  private injectRegexEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomRegexEntityTypeSchema
  ): Promise<void> {
    return new Promise((resolve) => {
      this.manager.addRegexRule(
        lang,
        entityConfig.name,
        new RegExp(entityConfig.regex, 'g')
      )

      resolve()
    })
  }

  /**
   * Inject enum type entities
   */
  private injectEnumEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomEnumEntityTypeSchema
  ): Promise<void> {
    return new Promise((resolve) => {
      const { name: entityName, options } = entityConfig
      const optionKeys = Object.keys(options)

      optionKeys.forEach((optionName) => {
        const { synonyms } = options[optionName] as { synonyms: string[] }

        this.manager.addRuleOptionTexts(lang, entityName, optionName, synonyms)
      })

      resolve()
    })
  }
}
