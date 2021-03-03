import { NlpManager } from 'node-nlp'
import request from 'superagent'
import fs from 'fs'
import path from 'path'

import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import Ner from '@/core/ner'
import log from '@/helpers/log'
import string from '@/helpers/string'

class Nlu {
  constructor (brain) {
    this.brain = brain
    this.request = request
    this.classifier = { }
    this.ner = new Ner()

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
        log.title('NLU')

        try {
          const data = fs.readFileSync(classifierFile, 'utf8')
          const nlpManager = new NlpManager()

          nlpManager.import(data)
          this.classifier = nlpManager

          log.success('Classifier loaded')
          resolve()
        } catch (err) {
          this.brain.talk(`${this.brain.wernicke('random_errors')}! ${this.brain.wernicke('errors', 'nlu', { '%error%': err.message })}.`)
          this.brain.socket.emit('is-typing', false)

          reject({ type: 'error', obj: err })
        }
      }
    })
  }

  /**
   * Classify the query,
   * pick-up the right classification
   * and extract entities
   */
  async process (query) {
    log.title('NLU')
    log.info('Processing...')

    query = string.ucfirst(query)

    if (Object.keys(this.classifier).length === 0) {
      this.brain.talk(`${this.brain.wernicke('random_errors')}!`)
      this.brain.socket.emit('is-typing', false)

      log.error('The expressions classifier is missing, please rebuild the project or if you are in dev run: npm run train expressions')

      return false
    }

    const lang = langs[process.env.LEON_LANG].short
    const result = await this.classifier.process(lang, query)
    const { domain, intent, score, entities } = result
    const [moduleName, actionName] = intent.split('.')
    let obj = {
      query,
      entities,
      classification: {
        package: domain,
        module: moduleName,
        action: actionName,
        confidence: score
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
          lang,
          classification: obj.classification
        })
        .then(() => { /* */ })
        .catch(() => { /* */ })
    }

    if (intent === 'None') {
      const fallback = Nlu.fallback(obj, langs[process.env.LEON_LANG].fallbacks)

      if (fallback === false) {
        this.brain.talk(`${this.brain.wernicke('random_unknown_queries')}.`, true)
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
      obj.entities = await this.ner.extractActionEntities(
        lang,
        path.join(__dirname, '../../../packages', obj.classification.package, `data/expressions/${lang}.json`),
        obj
      )
    } catch (e) /* istanbul ignore next */ {
      log[e.type](e.obj.message)
      this.brain.talk(`${this.brain.wernicke(e.code, '', e.data)}!`)
    }

    try {
      // Inject action entities with the others if there is
      await this.brain.execute(obj)
    } catch (e) /* istanbul ignore next */ {
      log[e.type](e.obj.message)
      this.brain.socket.emit('is-typing', false)
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
          obj.entities = []
          obj.classification.package = fallbacks[i].package
          obj.classification.module = fallbacks[i].module
          obj.classification.action = fallbacks[i].action
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
