'use strict'

import { LogisticRegressionClassifier } from 'natural'
import request from 'superagent'
import fs from 'fs'

import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import log from '@/helpers/log'
import string from '@/helpers/string'

class Nlu {
  constructor (brain) {
    this.brain = brain
    this.request = request
    this.classifier = { }

    log.title('NLU')
    log.success('New instance')
  }

  /**
   * Load the expressions classifier from the latest training
   */
  loadModel (classifierFile) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(classifierFile)) {
        log.title('NLU')
        reject({ type: 'warning', obj: new Error('The expressions classifier does not exist, please run: npm run train expressions') })
      } else {
        LogisticRegressionClassifier.load(classifierFile, null, (err, classifier) => {
          log.title('NLU')

          /* istanbul ignore if */
          if (err) {
            this.brain.talk(`${this.brain.wernicke('random_errors')}! ${this.brain.wernicke('errors', 'nlu', { '%error%': err.message })}.`)
            this.brain.socket.emit('is-typing', false)
            reject({ type: 'error', obj: err })
          } else {
            this.classifier = classifier
            this.classifier.train()
            log.success('Classifier loaded')
            resolve()
          }
        })
      }
    })
  }

  /**
   * Classify the query
   * and pick-up the right classification
   */
  async process (query) {
    log.title('NLU')
    log.info('Processing...')

    query = string.removeAccents(string.ucfirst(query))

    if (Object.keys(this.classifier).length === 0) {
      this.brain.talk(`${this.brain.wernicke('random_errors')}!`)
      this.brain.socket.emit('is-typing', false)

      log.error('The expressions classifier is missing, please rebuild the project or if you are in dev run: npm run train expressions')

      return false
    }

    const result = this.classifier.classify(query)
    const packageName = result.substr(0, result.indexOf(':'))
    const moduleName = result.substr(result.indexOf(':') + 1)
    const classifications = this.classifier.getClassifications(query)
    let obj = {
      query,
      classification: {
        package: packageName,
        module: moduleName,
        confidence: classifications[0].value
      }
    }

    /* istanbul ignore next */
    if (process.env.LEON_LOGGER === 'true' && process.env.LEON_NODE_ENV !== 'testing') {
      this.request
        .post('https://logger.getleon.ai/v1/expressions')
        .set('X-Origin', 'leon-core')
        .send({
          version,
          query,
          lang: langs[process.env.LEON_LANG].short,
          classification: obj.classification
        })
        .then(() => { /* */ })
        .catch(() => { /* */ })
    }

    if (obj.classification.confidence <= 0.5) {
      const fallback = Nlu.fallback(obj, langs[process.env.LEON_LANG].fallbacks)

      if (fallback === false) {
        this.brain.talk(`${this.brain.wernicke('random_unknown_queries')}.`)
        this.brain.socket.emit('is-typing', false)

        log.title('NLU')
        log.warning('Query not found')

        return false
      }

      obj = fallback
    }

    log.title('NLU')
    log.success('Query found')

    try {
      await this.brain.execute(obj)
    } catch (e) {
      /* istanbul ignore next */
      log[e.type](e.obj.message || e.obj)
    }

    return true
  }

  /**
   * Pickup and compare the right fallback
   * according to the wished module
   */
  static fallback (obj, fallbacks) {
    const words = obj.query.toLowerCase().split(' ')

    if (fallbacks.length > 0) {
      log.info('Looking for fallbacks...')
      const tmpWords = []

      for (let i = 0; i < fallbacks.length; i += 1) {
        for (let j = 0; j < fallbacks[i].words.length; j += 1) {
          if (words.includes(fallbacks[i].words[j]) === true) {
            tmpWords.push(fallbacks[i].words[j])
          }
        }

        if (JSON.stringify(tmpWords) === JSON.stringify(fallbacks[i].words)) {
          obj.classification.package = fallbacks[i].package
          obj.classification.module = fallbacks[i].module
          obj.classification.confidence = 1

          log.success('Fallback found')
          return obj
        }
      }
    }

    return false
  }
}

export default Nlu
