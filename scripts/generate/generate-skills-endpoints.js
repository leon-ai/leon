import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'

import { langs } from '@@/core/langs.json'
import domain from '@/helpers/domain'

dotenv.config()

/**
 * Generate skills endpoints script
 * Parse and convert skills NLU config into a JSON file understandable by Fastify
 * to dynamically generate endpoints so skills can be accessible over HTTP
 */
export default () => new Promise(async (resolve, reject) => {
  const supportedMethods = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']
  const outputFile = '/core/skills-endpoints.json'
  const outputFilePath = path.join(__dirname, `../..${outputFile}`)
  const lang = langs[process.env.LEON_HTTP_API_LANG].short

  try {
    const [domainKeys, domains] = await Promise.all([domain.list(), domain.getDomainsObj()])
    const finalObj = {
      endpoints: []
    }
    let isFileNeedToBeGenerated = true
    let loopIsBroken = false

    // Check if a new routing generation is necessary
    if (fs.existsSync(outputFilePath)) {
      const mtimeEndpoints = fs.statSync(outputFilePath).mtime.getTime()

      for (let i = 0; i < domainKeys.length; i += 1) {
        const currentDomain = domains[domainKeys[i]]
        const skillKeys = Object.keys(currentDomain.skills)

        // Browse skills
        for (let j = 0; j < skillKeys.length; j += 1) {
          const skillFriendlyName = skillKeys[j]
          const currentSkill = currentDomain.skills[skillFriendlyName]
          const fileInfo = fs.statSync(path.join(currentSkill.path, 'nlu', `${lang}.json`))
          const mtime = fileInfo.mtime.getTime()

          if (mtime > mtimeEndpoints) {
            loopIsBroken = true
            break
          }
        }

        if (loopIsBroken) {
          break
        }

        if ((i + 1) === domainKeys.length) {
          log.success(`${outputFile} is already up-to-date`)
          isFileNeedToBeGenerated = false
        }
      }
    }

    // Force if a language is given
    if (isFileNeedToBeGenerated) {
      log.info('Parsing skills NLU configuration...')

      for (let i = 0; i < domainKeys.length; i += 1) {
        const currentDomain = domains[domainKeys[i]]
        const skillKeys = Object.keys(currentDomain.skills)

        // Browse skills
        for (let j = 0; j < skillKeys.length; j += 1) {
          const skillFriendlyName = skillKeys[j]
          const currentSkill = currentDomain.skills[skillFriendlyName]

          const nluFilePath = path.join(currentSkill.path, 'nlu', `${lang}.json`)
          const { actions } = JSON.parse(fs.readFileSync(nluFilePath, 'utf8'))
          const actionsKeys = Object.keys(actions)

          for (let k = 0; k < actionsKeys.length; k += 1) {
            const action = actionsKeys[k]
            const actionObj = actions[action]
            const { entities, http_api } = actionObj // eslint-disable-line camelcase
            let finalMethod = (entities || http_api?.entities) ? 'POST' : 'GET'

            // Only generate this route if it is not disabled from the skill config
            if (!http_api?.disabled || (http_api?.disabled && http_api?.disabled === false)) {
              if (http_api?.method) {
                finalMethod = http_api.method.toUpperCase()
              }

              if (!supportedMethods.includes(finalMethod)) {
                reject(`The "${finalMethod}" HTTP method of the ${currentDomain.name}/${currentSkill.name}/${action} action is not supported`)
              }

              const endpoint = {
                method: finalMethod.toUpperCase(),
                route: `/api/action/${currentDomain.name}/${currentSkill.name}/${action}`,
                params: []
              }

              if (http_api?.timeout) {
                endpoint.timeout = http_api.timeout
              }
              if (entities) {
                // Handle explicit trim entities
                endpoint.entitiesType = 'trim'
                endpoint.params = entities.map((entity) => entity.name)
              } else if (http_api?.entities) {
                // Handle built-in entities
                endpoint.entitiesType = 'builtIn'
                endpoint.params = http_api.entities.map((entity) => entity.entity)
              }

              finalObj.endpoints.push(endpoint)
            }
          }
        }
      }

      log.info(`Writing ${outputFile} file...`)
      try {
        fs.writeFileSync(outputFilePath, JSON.stringify(finalObj, null, 2))
        log.success(`${outputFile} file generated`)
        resolve()
      } catch (e) {
        reject(`Failed to generate ${outputFile} file: ${e.message}`)
      }
    }
  } catch (e) {
    log.error(e.message)
    reject(e)
  }
})
