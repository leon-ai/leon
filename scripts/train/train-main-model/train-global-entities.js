import path from 'path'
import fs from 'fs'

import { LOG } from '@/helpers/log'

/**
 * Train global entities
 * Add global entities annotations (@...)
 */
export default (lang, nlp) =>
  new Promise((resolve) => {
    LOG.title('Global entities training')

    const globalEntitiesPath = path.join(
      process.cwd(),
      'core/data',
      lang,
      'global-entities'
    )
    const globalEntityFiles = fs.readdirSync(globalEntitiesPath)
    const newEntitiesObj = {}

    for (let i = 0; i < globalEntityFiles.length; i += 1) {
      const globalEntityFileName = globalEntityFiles[i]
      const [entityName] = globalEntityFileName.split('.')
      const globalEntityPath = path.join(
        globalEntitiesPath,
        globalEntityFileName
      )
      const { options } = JSON.parse(fs.readFileSync(globalEntityPath, 'utf8'))
      const optionKeys = Object.keys(options)
      const optionsObj = {}

      LOG.info(`[${lang}] Adding "${entityName}" global entity...`)

      optionKeys.forEach((optionKey) => {
        const { synonyms } = options[optionKey]

        optionsObj[optionKey] = synonyms
      })

      newEntitiesObj[entityName] = { options: optionsObj }
      LOG.success(`[${lang}] "${entityName}" global entity added`)
    }

    nlp.addEntities(newEntitiesObj, lang)

    resolve()
  })
