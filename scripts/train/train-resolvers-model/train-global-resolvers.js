import path from 'path'
import fs from 'fs'

import log from '@/helpers/log'

/**
 * Train global resolvers
 */
export default (lang, nlp) => new Promise((resolve) => {
  log.title('Global resolvers training')

  const resolversPath = path.join(process.cwd(), 'core/data', lang, 'global-resolvers')
  const resolverFiles = fs.readdirSync(resolversPath)

  for (let i = 0; i < resolverFiles.length; i += 1) {
    const resolverFileName = resolverFiles[i]
    const resolverPath = path.join(resolversPath, resolverFileName)
    const { name: resolverName, intents: resolverIntents } = JSON.parse(fs.readFileSync(resolverPath, 'utf8'))
    const intentKeys = Object.keys(resolverIntents)

    log.info(`[${lang}] Training "${resolverName}" resolver...`)

    for (let j = 0; j < intentKeys.length; j += 1) {
      const intentName = intentKeys[j]
      const intent = `resolver.global.${resolverName}.${intentName}`
      const intentObj = resolverIntents[intentName]

      nlp.assignDomain(lang, intent, 'system')

      for (let k = 0; k < intentObj.utterance_samples.length; k += 1) {
        nlp.addDocument(lang, intentObj.utterance_samples[k], intent)
      }
    }

    log.success(`[${lang}] "${resolverName}" resolver trained`)
  }

  resolve()
})
