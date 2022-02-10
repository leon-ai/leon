/**
 * @nlpjs/core is dedicated to web (browsers)
 * @nlpjs/core-loader can make use of file system
 * https://github.com/axa-group/nlp.js/issues/766#issuecomment-750315909
 */
import { containerBootstrap } from '@nlpjs/core-loader'
import { Ner as NerManager } from '@nlpjs/ner'
import { BuiltinMicrosoft } from '@nlpjs/builtin-microsoft'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

class Ner {
  constructor () {
    this.container = containerBootstrap()
    this.container.register('extract-builtin-??', new BuiltinMicrosoft(), true)
    this.ner = new NerManager({ container: this.container })

    log.title('NER')
    log.success('New instance')
  }

  static logExtraction (entities) {
    entities.forEach((ent) => log.success(`{ value: ${ent.sourceText}, entity: ${ent.entity} }`))
  }

  /**
   * Grab entities and match them with the utterance
   */
  async extractEntities (lang, utteranceSamplesFilePath, obj) {
    log.title('NER')
    log.info('Searching for entities...')

    const { classification } = obj
    // Remove end-punctuation and add an end-whitespace
    const utterance = `${string.removeEndPunctuation(obj.utterance)} `
    const utteranceSamplesObj = JSON.parse(fs.readFileSync(utteranceSamplesFilePath, 'utf8'))
    const { module, action } = classification
    const promises = []
    const actionEntities = utteranceSamplesObj[module][action].entities || []

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
      }
    }

    await Promise.all(promises)

    const { entities } = await this.ner.process({ locale: lang, text: utterance })

    // Trim whitespace at the beginning and the end of the entity value
    entities.map((e) => {
      e.sourceText = e.sourceText.trim()
      e.utteranceText = e.utteranceText.trim()

      return e
    })

    if (entities.length > 0) {
      Ner.logExtraction(entities)
      return entities
    }

    log.info('No entity found')
    return []
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
          if (Array.isArray(condition.from) && Array.isArray(condition.to)) {
            const { from, to } = condition

            from.forEach((word, index) => {
              this.ner[conditionMethod](lang, entity.name, word, to[index])
            })
          } else {
            this.ner[conditionMethod](lang, entity.name, condition.from, condition.to)
          }
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
