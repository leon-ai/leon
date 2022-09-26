/**
 * @nlpjs/core is dedicated to web (browsers)
 * @nlpjs/core-loader can make use of file system
 * https://github.com/axa-group/nlp.js/issues/766#issuecomment-750315909
 */
import fs from 'fs'

import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

class Ner {
  constructor(ner) {
    this.ner = ner

    LogHelper.title('NER')
    LogHelper.success('New instance')
  }

  static logExtraction(entities) {
    LogHelper.title('NER')
    LogHelper.success('Entities found:')
    entities.forEach((ent) =>
      LogHelper.success(`{ value: ${ent.sourceText}, entity: ${ent.entity} }`)
    )
  }

  /**
   * Grab entities and match them with the utterance
   */
  extractEntities(lang, utteranceSamplesFilePath, obj) {
    return new Promise(async (resolve) => {
      LogHelper.title('NER')
      LogHelper.info('Searching for entities...')

      const { classification } = obj
      // Remove end-punctuation and add an end-whitespace
      const utterance = `${StringHelper.removeEndPunctuation(obj.utterance)} `
      const { actions } = JSON.parse(
        fs.readFileSync(utteranceSamplesFilePath, 'utf8')
      )
      const { action } = classification
      const promises = []
      const actionEntities = actions[action].entities || []

      /**
       * Browse action entities
       * Dynamic injection of the action entities depending of the entity type
       */
      for (let i = 0; i < actionEntities.length; i += 1) {
        const entity = actionEntities[i]

        if (entity.type === 'regex') {
          promises.push(this.injectRegexEntity(lang, entity))
        } else if (entity.type === 'trim') {
          promises.push(this.injectTrimEntity(lang, entity))
        } else if (entity.type === 'enum') {
          promises.push(this.injectEnumEntity(lang, entity))
        }
      }

      await Promise.all(promises)

      const { entities } = await this.ner.process({
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

        return entity
      })

      if (entities.length > 0) {
        Ner.logExtraction(entities)
        return resolve(entities)
      }

      LogHelper.title('NER')
      LogHelper.info('No entity found')
      return resolve([])
    })
  }

  /**
   * Get spaCy entities from the TCP server
   */
  static getSpacyEntities(utterance) {
    return new Promise((resolve) => {
      const spacyEntitiesReceivedHandler = async ({ spacyEntities }) => {
        resolve(spacyEntities)
      }

      global.tcpClient.ee.removeAllListeners()
      global.tcpClient.ee.on(
        'spacy-entities-received',
        spacyEntitiesReceivedHandler
      )

      global.tcpClient.emit('get-spacy-entities', utterance)
    })
  }

  /**
   * Inject trim type entities
   */
  injectTrimEntity(lang, entity) {
    return new Promise((resolve) => {
      for (let j = 0; j < entity.conditions.length; j += 1) {
        const condition = entity.conditions[j]
        const conditionMethod = `add${StringHelper.snakeToPascalCase(
          condition.type
        )}Condition`

        if (condition.type === 'between') {
          /**
           * Conditions: https://github.com/axa-group/nlp.js/blob/master/docs/v3/ner-manager.md#trim-named-entities
           * e.g. list.addBetweenCondition('en', 'list', 'create a', 'list')
           */
          this.ner[conditionMethod](
            lang,
            entity.name,
            condition.from,
            condition.to
          )
        } else if (condition.type.indexOf('after') !== -1) {
          const rule = {
            type: 'afterLast',
            words: condition.from,
            options: {}
          }
          this.ner.addRule(lang, entity.name, 'trim', rule)
          this.ner[conditionMethod](lang, entity.name, condition.from)
        } else if (condition.type.indexOf('before') !== -1) {
          this.ner[conditionMethod](lang, entity.name, condition.to)
        }
      }

      resolve()
    })
  }

  /**
   * Inject regex type entities
   */
  injectRegexEntity(lang, entity) {
    return new Promise((resolve) => {
      this.ner.addRegexRule(lang, entity.name, new RegExp(entity.regex, 'g'))

      resolve()
    })
  }

  /**
   * Inject enum type entities
   */
  injectEnumEntity(lang, entity) {
    return new Promise((resolve) => {
      const { name: entityName, options } = entity
      const optionKeys = Object.keys(options)

      optionKeys.forEach((optionName) => {
        const { synonyms } = options[optionName]

        this.ner.addRuleOptionTexts(lang, entityName, optionName, synonyms)
      })

      resolve()
    })
  }

  /**
   * Get Microsoft builtin entities
   * https://github.com/axa-group/nlp.js/blob/master/packages/builtin-microsoft/src/builtin-microsoft.js
   */
  static getMicrosoftBuiltinEntities() {
    return [
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
  }
}

export default Ner
