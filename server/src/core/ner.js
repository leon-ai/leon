/**
 * @nlpjs/core is dedicated to web (browsers)
 * @nlpjs/core-loader can make use of file system
 * https://github.com/axa-group/nlp.js/issues/766#issuecomment-750315909
 */
import { containerBootstrap } from '@nlpjs/core-loader'
import {
  ExtractorRegex,
  ExtractorTrim,
  Ner as NerManager
} from '@nlpjs/nlp'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

class Ner {
  constructor () {
    this.ner = { }
    this.container = containerBootstrap()
    this.supportedEntityTypes = [
      'regex',
      'trim'
    ]

    this.container.use(ExtractorRegex)
    this.container.use(ExtractorTrim)

    log.title('NER')
    log.success('New instance')
  }

  static logExtraction (entities) {
    entities.forEach((ent) => log.success(`{ value: ${ent.sourceText}, entity: ${ent.entity} }`))
  }

  /**
   * Grab action entities and match them with the query
   */
  extractActionEntities (lang, expressionsFilePath, obj) {
    return new Promise(async (resolve, reject) => {
      log.title('NER')
      log.info('Searching for entities...')

      // Need to instanciate on the fly to flush entities
      this.ner = new NerManager({ container: this.container })

      const { entities: builtInEntities, classification } = obj
      // Remove end-punctuation and add an end-whitespace
      const query = `${string.removeEndPunctuation(obj.query)} `
      const expressionsObj = JSON.parse(fs.readFileSync(expressionsFilePath, 'utf8'))
      const { module, action } = classification
      const promises = []

      // Verify the action has entities
      if (typeof expressionsObj[module][action].entities !== 'undefined') {
        const actionEntities = expressionsObj[module][action].entities

        /**
         * Browse action entities
         * Dynamic injection of the action entities depending of the entity type
         */
        for (let i = 0; i < actionEntities.length; i += 1) {
          const entity = actionEntities[i]

          if (!this.supportedEntityTypes.includes(entity.type)) {
            reject({
              type: 'warning', obj: new Error(`"${entity.type}" action entity type not supported`), code: 'random_ner_type_not_supported', data: { '%entity_type%': entity.type }
            })
          } else if (entity.type === 'regex') {
            promises.push(this.injectRegexEntity(lang, entity))
          } else if (entity.type === 'trim') {
            promises.push(this.injectTrimEntity(lang, entity))
          }
        }

        await Promise.all(promises)

        // Merge built-in and named entities
        const nerEntities = (
          await this.ner.process({ locale: lang, text: query })
        ).entities.concat(builtInEntities)

        // Trim whitespace at the beginning and the end of the entity value
        nerEntities.map((e) => {
          e.sourceText = e.sourceText.trim()
          e.utteranceText = e.utteranceText.trim()

          return e
        })

        Ner.logExtraction(nerEntities)

        resolve(nerEntities)
      } else {
        if (builtInEntities.length > 0) {
          Ner.logExtraction(builtInEntities)
        } else {
          log.info('No entity found')
        }

        resolve(builtInEntities)
      }
    })
  }

  /**
   * Inject trim type entities
   */
  injectTrimEntity (lang, entity) {
    return new Promise((resolve) => {
      for (let j = 0; j < entity.conditions.length; j += 1) {
        const condition = entity.conditions[j]
        const conditionMethod = `add${string.snakeToPascalCase(condition.type)}Condition`

        if (condition.type === 'between') {
          // e.g. list.addBetweenCondition('en', 'list', 'create a', 'list')
          this.ner[conditionMethod](lang, entity.name, condition.from, condition.to)
        } else if (condition.type.indexOf('after') !== -1) {
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
  injectRegexEntity (lang, entity) {
    return new Promise((resolve) => {
      this.ner.addRegexRule(lang, entity.name, new RegExp(entity.regex, 'g'))

      resolve()
    })
  }
}

export default Ner
