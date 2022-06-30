import path from 'path'
import fs from 'fs'

import log from '@/helpers/log'

/**
 * Train global entities
 */
export default (lang, nlp) => new Promise((resolve) => {
  log.title('Global resolvers training')

  const resolversPath = path.join(process.cwd(), 'core/data', lang, 'resolvers')
  const resolverFiles = fs.readdirSync(resolversPath)

  // Add global entities annotations (@...)
  // Train resolvers
  for (let i = 0; i < resolverFiles.length; i += 1) {
    const resolverFileName = resolverFiles[i]
    const resolverPath = path.join(resolversPath, resolverFileName)
    const { name: resolverName, intents: resolverIntents } = JSON.parse(fs.readFileSync(resolverPath, 'utf8'))
    const intentKeys = Object.keys(resolverIntents)

    log.info(`[${lang}] Training "${resolverName}" resolver...`)

    for (let j = 0; j < intentKeys.length; j += 1) {
      const intentName = intentKeys[j]
      const intentObj = resolverIntents[intentName]

      nlp.assignDomain(lang, intentName, 'system')

      for (let k = 0; k < intentObj.utterance_samples.length; k += 1) {
        nlp.addDocument(lang, intentObj.utterance_samples[k], intentName)
      }
    }

    log.success(`[${lang}] "${resolverName}" resolver trained`)
  }

  resolve()
})
