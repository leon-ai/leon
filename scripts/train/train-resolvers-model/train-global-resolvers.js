import path from 'node:path'
import fs from 'node:fs'

import { composeFromPattern } from '@nlpjs/utils'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Train global resolvers
 */
export default (lang, nlp) =>
  new Promise((resolve) => {
    LogHelper.title('Global resolvers training')

    const resolversPath = path.join(
      process.cwd(),
      'core/data',
      lang,
      'global-resolvers'
    )
    const resolverFiles = fs.readdirSync(resolversPath)

    for (let i = 0; i < resolverFiles.length; i += 1) {
      const resolverFileName = resolverFiles[i]
      const resolverPath = path.join(resolversPath, resolverFileName)
      const { name: resolverName, intents: resolverIntents } = JSON.parse(
        fs.readFileSync(resolverPath, 'utf8')
      )
      const intentKeys = Object.keys(resolverIntents)

      LogHelper.info(`[${lang}] Training "${resolverName}" resolver...`)

      for (let j = 0; j < intentKeys.length; j += 1) {
        const intentName = intentKeys[j]
        const intent = `resolver.global.${resolverName}.${intentName}`
        const intentObj = resolverIntents[intentName]

        nlp.assignDomain(lang, intent, 'system')

        for (let k = 0; k < intentObj.utterance_samples.length; k += 1) {
          const utteranceSample = intentObj.utterance_samples[k]
          // Achieve Cartesian training
          const utteranceAlternatives = composeFromPattern(utteranceSample)

          utteranceAlternatives.forEach((utteranceAlternative) => {
            nlp.addDocument(lang, utteranceAlternative, intent)
          })
        }
      }

      LogHelper.success(`[${lang}] "${resolverName}" resolver trained`)
    }

    resolve()
  })
