import type { ShortLanguageCode } from '@/types'
import type {
  BuiltInEntityType,
  NERDurationUnit,
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
  SkillCustomTrimEntityTypeSchema,
  SkillCustomLLMEntityTypeSchema
} from '@/schemas/skill-schemas'
import { BRAIN, MODEL_LOADER, PYTHON_TCP_CLIENT, LLM_MANAGER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { CustomNERLLMDuty } from '@/core/llm-manager/llm-duties/custom-ner-llm-duty'

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

function getDurationUnit(duration: string): NERDurationUnit | null {
  const mapping = {
    PT: {
      S: 'seconds',
      M: 'minutes',
      H: 'hours'
    },
    P: {
      D: 'days',
      W: 'weeks',
      M: 'months',
      Y: 'years'
    }
  }

  const prefix = duration.slice(0, 2)
  const lastChar = duration.slice(-1)

  if (prefix === 'PT') {
    return (
      (mapping.PT[lastChar as keyof typeof mapping.PT] as NERDurationUnit) ??
      null
    )
  }
  if (prefix.startsWith('P')) {
    return (
      (mapping.P[lastChar as keyof typeof mapping.P] as NERDurationUnit) ?? null
    )
  }

  LogHelper.title('NER')
  LogHelper.error(`Failed to get the duration unit: ${duration}`)

  return null
}

export default class NER {
  private static instance: NER
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

  public extractBuiltInEntities(
    lang: ShortLanguageCode,
    utterance: NLPUtterance
  ): Promise<NEREntity[]> {
    return new Promise(async (resolve, reject) => {
      try {
        LogHelper.title('NER')
        LogHelper.info('Looking for built-in entities...')

        // Remove end-punctuation and add an end-whitespace
        const formattedUtterance = `${StringHelper.removeEndPunctuation(
          utterance
        )} `

        const { entities: extractedEntities }: { entities: NEREntity[] } =
          await MODEL_LOADER.mainNLPContainer.ner.process({
            locale: lang,
            text: formattedUtterance
          })

        // Normalize entities
        extractedEntities.forEach((entity) => {
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

            if (entity.type === 'duration' && entity.resolution.values[0]) {
              entity.resolution.values[0] = {
                ...entity.resolution.values[0],
                unit: getDurationUnit(
                  entity.resolution.values[0].timex
                ) as NERDurationUnit
              }
            }
          }

          /*if (SPACY_ENTITY_TYPES.includes(entity.entity as SpacyEntityType)) {
            entity.type = entity.entity as SpacyEntityType
            if (
              'value' in entity.resolution &&
              this.spacyData.has(`${entity.type}-${entity.resolution.value}`)
            ) {
              entity.resolution = this.spacyData.get(
                `${entity.type}-${entity.resolution.value}`
              ) as NERSpacyEntity['resolution']
            }
          }*/

          return entity
        })

        if (extractedEntities.length > 0) {
          NER.logExtraction(extractedEntities)
          return resolve(extractedEntities)
        }

        LogHelper.title('NER')
        LogHelper.info('No entity found')

        return resolve([])
      } catch (e) {
        LogHelper.title('NER')
        LogHelper.error(`Failed to extract entities: ${e}`)

        return reject([])
      }
    })
  }

  /**
   * TODO: delete extract entities
   * Grab entities and match them with the utterance
   */
  public extractEntities(
    lang: ShortLanguageCode,
    skillConfigPath: string,
    nluResult: NLUResult
  ): Promise<NEREntity[]> {
    return new Promise(async (resolve, reject) => {
      try {
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
        const actionEntities = actions[action]?.entities || []
        let foundLLMEntities: NEREntity[] = []

        /**
         * Browse action entities
         * Dynamic injection of the action entities depending on the entity type
         */
        for (let i = 0; i < actionEntities.length; i += 1) {
          const actionEntityConfig = actionEntities[i]

          if (actionEntityConfig?.type === 'regex') {
            this.injectRegexEntity(lang, actionEntityConfig)
          } else if (actionEntityConfig?.type === 'trim') {
            this.injectTrimEntity(lang, actionEntityConfig)
          } else if (actionEntityConfig?.type === 'enum') {
            this.injectEnumEntity(lang, actionEntityConfig)
          } else if (actionEntityConfig?.type === 'llm') {
            try {
              if (LLM_MANAGER.isLLMEnabled) {
                foundLLMEntities = await this.injectLLMEntity(
                  actionEntityConfig,
                  utterance
                )
              } else {
                LogHelper.title('NER')
                LogHelper.warning(
                  'LLM is not enabled. This skill action entity will be ignored.'
                )
                await BRAIN.talk(`${BRAIN.wernicke('llm_not_enabled')}.`)

                resolve([])
              }
            } catch (e) {
              LogHelper.title('NER')
              LogHelper.error(`Failed to inject LLM entity: ${e}`)

              resolve([])
            }
          }
        }

        const { entities: extractedEntities }: { entities: NEREntity[] } =
          await MODEL_LOADER.mainNLPContainer.ner.process({
            locale: lang,
            text: utterance
          })
        const entities = [...extractedEntities, ...foundLLMEntities]

        // Normalize entities
        entities.forEach((entity) => {
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

            if (entity.type === 'duration' && entity.resolution.values[0]) {
              entity.resolution.values[0] = {
                ...entity.resolution.values[0],
                unit: getDurationUnit(
                  entity.resolution.values[0].timex
                ) as NERDurationUnit
              }
            }
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
      } catch (e) {
        LogHelper.title('NER')
        LogHelper.error(`Failed to extract entities: ${e}`)

        return reject([])
      }
    })
  }

  /**
   * Merge spaCy entities with the NER instance
   */
  public async mergeSpacyEntities(utterance: NLPUtterance): Promise<void> {
    const nbOfWords = utterance.split(' ').length

    if (nbOfWords > 128) {
      LogHelper.title('NER')
      LogHelper.warning(
        'This utterance is too long to be processed by spaCy, so spaCy entities will not be merged'
      )

      return
    }

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

      PYTHON_TCP_CLIENT.ee.removeAllListeners()
      PYTHON_TCP_CLIENT.ee.on(
        'spacy-entities-received',
        spacyEntitiesReceivedHandler
      )

      PYTHON_TCP_CLIENT.emit('get-spacy-entities', utterance)
    })
  }

  /**
   * Inject trim type entities
   */
  private injectTrimEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomTrimEntityTypeSchema
  ): void {
    for (let i = 0; i < entityConfig.conditions.length; i += 1) {
      const condition = entityConfig.conditions[i]
      const conditionMethod = `addNer${StringHelper.snakeToPascalCase(
        condition?.type || ''
      )}Condition`

      if (condition?.type === 'between') {
        /**
         * Conditions: https://github.com/axa-group/nlp.js/blob/master/docs/v3/ner-manager.md#trim-named-entities
         * e.g. list.addBetweenCondition('en', 'list', 'create a', 'list')
         */
        MODEL_LOADER.mainNLPContainer[conditionMethod](
          lang,
          entityConfig.name,
          condition?.from,
          condition?.to
        )
      } else if (condition?.type.indexOf('after') !== -1) {
        MODEL_LOADER.mainNLPContainer[conditionMethod](
          lang,
          entityConfig.name,
          condition?.from
        )
      } else if (condition.type.indexOf('before') !== -1) {
        MODEL_LOADER.mainNLPContainer[conditionMethod](
          lang,
          entityConfig.name,
          condition.to
        )
      }
    }
  }

  /**
   * Inject regex type entities
   */
  private injectRegexEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomRegexEntityTypeSchema
  ): void {
    MODEL_LOADER.mainNLPContainer.addNerRegexRule(
      lang,
      entityConfig.name,
      new RegExp(entityConfig.regex, 'g')
    )
  }

  /**
   * Inject enum type entities
   */
  private injectEnumEntity(
    lang: ShortLanguageCode,
    entityConfig: SkillCustomEnumEntityTypeSchema
  ): void {
    const { name: entityName, options } = entityConfig
    const optionKeys = Object.keys(options)

    optionKeys.forEach((optionName) => {
      const { synonyms } = options[optionName] as { synonyms: string[] }

      MODEL_LOADER.mainNLPContainer.addNerRuleOptionTexts(
        lang,
        entityName,
        optionName,
        synonyms
      )
    })
  }

  /**
   * Inject LLM type entities
   */
  private async injectLLMEntity(
    entityConfig: SkillCustomLLMEntityTypeSchema,
    utterance: NLPUtterance
  ): Promise<NEREntity[]> {
    const { schema } = entityConfig
    const customNERDuty = new CustomNERLLMDuty({
      input: utterance,
      data: {
        schema
      }
    })
    await customNERDuty.init()
    const result = await customNERDuty.execute()

    const schemaKeys = Object.keys(schema)
    return schemaKeys.map((key) => {
      const entityName = key
      const entityValue = result?.output[key] as string
      const lowerCaseUtterance = utterance.toLowerCase()
      const lowerCaseEntityValue = entityValue.toLowerCase()

      return {
        start: lowerCaseUtterance.indexOf(lowerCaseEntityValue),
        end:
          lowerCaseUtterance.indexOf(lowerCaseEntityValue) +
          lowerCaseEntityValue.length,
        len: entityValue.length,
        levenshtein: 0,
        accuracy: 1,
        entity: entityName,
        type: 'enum',
        option: entityValue,
        sourceText: entityValue,
        utteranceText: entityValue,
        resolution: {
          value: entityValue
        }
      }
    })
  }
}
