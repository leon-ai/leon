import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

import { LogHelper } from '@/helpers/log-helper'

import { langs } from '@@/core/langs.json'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

dotenv.config()

/**
 * Generate skills endpoints script
 * Parse and convert skills config into a JSON file understandable by Fastify
 * to dynamically generate endpoints so skills can be accessible over HTTP
 */
export default () =>
  new Promise(async (resolve, reject) => {
    const supportedMethods = [
      'DELETE',
      'GET',
      'HEAD',
      'PATCH',
      'POST',
      'PUT',
      'OPTIONS'
    ]
    const outputFile = '/core/skills-endpoints.json'
    const outputFilePath = path.join(__dirname, `../..${outputFile}`)
    const lang = langs[process.env.LEON_HTTP_API_LANG].short

    try {
      const skillDomains = await SkillDomainHelper.getSkillDomains()
      const finalObj = {
        endpoints: []
      }
      let isFileNeedToBeGenerated = true
      let loopIsBroken = false

      // Check if a new routing generation is necessary
      if (fs.existsSync(outputFilePath)) {
        const mtimeEndpoints = fs.statSync(outputFilePath).mtime.getTime()

        let i = 0
        for (const currentDomain of skillDomains.values()) {
          const skillKeys = Object.keys(currentDomain.skills)

          // Browse skills
          for (let j = 0; j < skillKeys.length; j += 1) {
            const skillFriendlyName = skillKeys[j]
            const currentSkill = currentDomain.skills[skillFriendlyName]
            const fileInfo = fs.statSync(
              path.join(currentSkill.path, 'config', `${lang}.json`)
            )
            const mtime = fileInfo.mtime.getTime()

            if (mtime > mtimeEndpoints) {
              loopIsBroken = true
              break
            }
          }

          if (loopIsBroken) {
            break
          }

          if (i + 1 === skillDomains.size) {
            LogHelper.success(`${outputFile} is already up-to-date`)
            isFileNeedToBeGenerated = false
          }

          i += 1
        }
      }

      // Force if a language is given
      if (isFileNeedToBeGenerated) {
        LogHelper.info('Parsing skills configuration...')

        for (const currentDomain of skillDomains.values()) {
          const skillKeys = Object.keys(currentDomain.skills)

          // Browse skills
          for (let j = 0; j < skillKeys.length; j += 1) {
            const skillFriendlyName = skillKeys[j]
            const currentSkill = currentDomain.skills[skillFriendlyName]

            const configFilePath = path.join(
              currentSkill.path,
              'config',
              `${lang}.json`
            )
            const { actions } = JSON.parse(
              fs.readFileSync(configFilePath, 'utf8')
            )
            const actionsKeys = Object.keys(actions)

            for (let k = 0; k < actionsKeys.length; k += 1) {
              const action = actionsKeys[k]
              const actionObj = actions[action]
              const { entities, http_api } = actionObj
              let finalMethod = entities || http_api?.entities ? 'POST' : 'GET'

              // Only generate this route if it is not disabled from the skill config
              if (
                !http_api?.disabled ||
                (http_api?.disabled && http_api?.disabled === false)
              ) {
                if (http_api?.method) {
                  finalMethod = http_api.method.toUpperCase()
                }

                if (!supportedMethods.includes(finalMethod)) {
                  reject(
                    `The "${finalMethod}" HTTP method of the ${currentDomain.name}/${currentSkill.name}/${action} action is not supported`
                  )
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
                  endpoint.params = http_api.entities.map(
                    (entity) => entity.entity
                  )
                }

                finalObj.endpoints.push(endpoint)
              }
            }
          }
        }

        LogHelper.info(`Writing ${outputFile} file...`)
        try {
          fs.writeFileSync(outputFilePath, JSON.stringify(finalObj, null, 2))
          LogHelper.success(`${outputFile} file generated`)
          resolve()
        } catch (e) {
          reject(`Failed to generate ${outputFile} file: ${e.message}`)
        }
      }
    } catch (e) {
      LogHelper.error(e.message)
      reject(e)
    }
  })
