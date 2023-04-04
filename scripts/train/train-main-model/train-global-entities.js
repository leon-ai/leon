import path from 'node:path'
import fs from 'node:fs'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Train global entities
 * Add global entities annotations (@...)
 */
export default (lang, nlp) =>
  new Promise(async (resolve) => {
    LogHelper.title('Global entities training')

    const globalEntitiesPath = path.join(
      process.cwd(),
      'core',
      'data',
      lang,
      'global-entities'
    )
    const globalEntityFiles = await fs.promises.readdir(globalEntitiesPath)
    const newEntitiesObj = {}

    for (let i = 0; i < globalEntityFiles.length; i += 1) {
      const globalEntityFileName = globalEntityFiles[i]
      const [entityName] = globalEntityFileName.split('.')
      const globalEntityPath = path.join(
        globalEntitiesPath,
        globalEntityFileName
      )
      const { options } = JSON.parse(
        await fs.promises.readFile(globalEntityPath, 'utf8')
      )
      const optionKeys = Object.keys(options)
      const optionsObj = {}

      LogHelper.info(`[${lang}] Adding "${entityName}" global entity...`)

      optionKeys.forEach((optionKey) => {
        const { synonyms } = options[optionKey]

        optionsObj[optionKey] = synonyms
      })

      newEntitiesObj[entityName] = { options: optionsObj }
      LogHelper.success(`[${lang}] "${entityName}" global entity added`)
    }

    nlp.addEntities(newEntitiesObj, lang)

    resolve()
  })
