import { LogisticRegressionClassifier } from 'natural'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

import { langs } from '../core/langs.json'

dotenv.config()

/**
 * Training script
 *
 * npm run train expressions
 * npm run train expressions:en
 */
export default () => new Promise((resolve, reject) => {
  const { argv } = process
  const packagesDir = 'packages'
  const expressionsClassifier = 'server/src/data/expressions/classifier.json'
  let type = (argv[2]) ? argv[2].toLowerCase() : 'expressions'
  let lang = ''

  if (type.indexOf(':') !== -1) {
    [type, lang] = type.split(':')
  } else {
    lang = langs[process.env.LEON_LANG].short.toLowerCase().substr(0, 2)
  }

  try {
    if (type === 'expressions') {
      let classifier = new LogisticRegressionClassifier()

      if (lang !== 'en') {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const PorterStemmer = require(`../node_modules/natural/lib/natural/stemmers/porter_stemmer_${lang}`)
        classifier = new LogisticRegressionClassifier(PorterStemmer)
      }
      const packages = fs.readdirSync(packagesDir)
        .filter(entity =>
          fs.statSync(path.join(packagesDir, entity)).isDirectory())
      let expressions = { }

      for (let i = 0; i < packages.length; i += 1) {
        log.info(`Training "${string.ucfirst(packages[i])}" package modules expressions...`)

        expressions = JSON.parse(fs.readFileSync(`${packagesDir}/${packages[i]}/data/expressions/${lang}.json`, 'utf8'))

        const modules = Object.keys(expressions)
        for (let j = 0; j < modules.length; j += 1) {
          const exprs = expressions[modules[j]]
          for (let k = 0; k < exprs.length; k += 1) {
            classifier.addDocument(string.removeAccents(exprs[k]), `${packages[i]}:${modules[j]}`)
          }

          log.success(`"${string.ucfirst(modules[j])}" module expressions trained`)
        }
      }

      classifier.save(expressionsClassifier, (err) => {
        if (err) {
          log.error(`Failed to save the classifier: ${err}`)
          reject()
        } else {
          log.success('Classifier saved in server/src/data/expressions/classifier.json')
          resolve()
        }
      })
    } else {
      log.error(`"${type}" training type is unknown. Try "npm run train expressions"`)
      reject()
    }
  } catch (e) {
    log.error(e.message)
    reject(e)
  }
})
