import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'

import { langs } from '@@/core/langs.json'

dotenv.config()

/**
 * Generate packages endpoints script
 * Parse and convert packages configuration into a JSON file understandable by Fastify
 * to dynamically generate endpoints so packages can be accessible over HTTP
 */
export default () => new Promise(async (resolve, reject) => {
  const supportedMethods = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']
  const packagesDir = 'packages'
  const outputFile = '/core/pkgs-endpoints.json'
  const lang = langs[process.env.LEON_LANG].short.toLowerCase().substr(0, 2)

  try {
    // TODO: check packages folder mtime first
    log.info('Parsing packages configuration...')

    const packages = fs.readdirSync(packagesDir)
      .filter((entity) => fs.statSync(path.join(packagesDir, entity)).isDirectory())
    const finalObj = {
      endpoints: []
    }
    let pkgObj = { }

    for (let i = 0; i < packages.length; i += 1) {
      const pkg = packages[i]

      pkgObj = JSON.parse(fs.readFileSync(`${packagesDir}/${pkg}/data/expressions/${lang}.json`, 'utf8'))

      const modules = Object.keys(pkgObj)
      for (let j = 0; j < modules.length; j += 1) {
        const module = modules[j]
        const actions = Object.keys(pkgObj[module])

        for (let k = 0; k < actions.length; k += 1) {
          const action = actions[k]
          const actionObj = pkgObj[module][action]
          const { entities, http_api } = actionObj // eslint-disable-line camelcase
          let finalMethod = entities ? 'POST' : 'GET'

          if (http_api?.method) {
            finalMethod = http_api.method.toUpperCase()
          }

          if (!supportedMethods.includes(finalMethod)) {
            reject(`The "${finalMethod}" HTTP method of the ${pkg}/${module}/${action} action is not supported`)
          }

          const endpoint = {
            method: finalMethod.toUpperCase(),
            route: `/p/${pkg}/${module}/${action}`,
            params: []
          }

          if (http_api?.timeout) {
            endpoint.timeout = http_api.timeout
          }
          if (entities) {
            endpoint.params = entities.map((entity) => entity.name)
          }

          finalObj.endpoints.push(endpoint)
        }
      }
    }

    log.info(`Writing ${outputFile} file...`)
    try {
      fs.writeFileSync(path.join(__dirname, `..${outputFile}`), JSON.stringify(finalObj, null, 2))
      log.success(`${outputFile} file generated`)
      resolve()
    } catch (e) {
      reject(`Failed to generate ${outputFile} file: ${e.message}`)
    }
  } catch (e) {
    log.error(e.message)
    reject(e)
  }
})
