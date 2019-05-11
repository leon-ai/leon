'use strict'

import { NerManager } from 'node-nlp'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

class Ner {
  constructor () {
    this.nerManager = new NerManager()
    this.supportedEntityTypes = [
      'regex',
      'trim'
    ]

    log.title('NER')
    log.success('New instance')
  }

  /**
   * Grab action entities and match them with the query
   */
  extractActionEntities (lang, obj) {
    return new Promise(async (resolve, reject) => {
      log.title('NER')
      log.info('Searching for entities...')

      const { query, entities, classification } = obj
      const expressionsFilePath = path.join(__dirname, '../../../packages', classification.package, `data/expressions/${lang}.json`)
      const expressionsObj = JSON.parse(fs.readFileSync(expressionsFilePath, 'utf8'))
      const { module, action } = classification

      // Verify the action has entities
      if (typeof expressionsObj[module][action].entities !== 'undefined') {
        const actionEntities = expressionsObj[module][action].entities

        // Browse action entities
        for (let i = 0; i < actionEntities.length; i += 1) {
          const entity = actionEntities[i]

          // TODO: dynamic entity matching
          if (!this.supportedEntityTypes.includes(entity.type)) {
            reject({ type: 'warning', obj: new Error(`"${entity.type}" action entity type not supported`), code: 'random_ner_type_not_supported', data: { '%entity_type%': entity.type } })
          } else {
            // Dynamic injection of the action entities depending of the entity type
            // eslint-disable-next-line
            if (entity.type === 'regex') {
              //
            } else if (entity.type === 'trim') {
              const e = this.nerManager.addNamedEntity(entity.name, entity.type)

              for (let j = 0; j < entity.conditions.length; j += 1) {
                const condition = entity.conditions[j]
                /**
                 * TODO: check every condition do the right job
                 */
                const conditionMethod = `add${string.snakeToPascalCase(condition.type)}Condition`

                // TODO: dynamic matching
                if (condition.type === 'between') {
                  e[conditionMethod](lang, condition.from, condition.to)
                }
              }
            }
          }
        }

        const nerEntities = await this.nerManager.findEntities(query, lang)
        Ner.logExtraction(nerEntities)

        resolve(nerEntities)
      } else {
        if (entities.length > 0) {
          Ner.logExtraction(entities)
        } else {
          log.info('No entity found')
        }

        resolve(entities)
      }
    })
  }

  static logExtraction (entities) {
    entities.forEach(ent => log.success(`{ value: ${ent.sourceText}, entity: ${ent.entity} }`))
  }
}

export default Ner
