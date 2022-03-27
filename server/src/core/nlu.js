import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { BuiltinMicrosoft } from '@nlpjs/builtin-microsoft'
import { LangAll } from '@nlpjs/lang-all'
import request from 'superagent'
import fs from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import kill from 'tree-kill'

import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import Ner from '@/core/ner'
import log from '@/helpers/log'
import string from '@/helpers/string'
import lang from '@/helpers/lang'
import TcpClient from '@/core/tcp-client'
import Conversation from '@/core/conversation'

class Nlu {
  constructor (brain) {
    this.brain = brain
    this.request = request
    this.nlp = { }
    this.ner = { }
    this.conv = new Conversation('conv0')

    log.title('NLU')
    log.success('New instance')
  }

  /**
   * Load the NLP model from the latest training
   */
  loadModel (nlpModel) {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(nlpModel)) {
        log.title('NLU')
        reject({ type: 'warning', obj: new Error('The NLP model does not exist, please run: npm run train') })
      } else {
        log.title('NLU')

        try {
          const container = await containerBootstrap()

          container.register('extract-builtin-??', new BuiltinMicrosoft({
            builtins: Ner.getMicrosoftBuiltinEntities()
          }), true)
          container.use(Nlp)
          container.use(LangAll)

          this.nlp = container.get('nlp')
          const nluManager = container.get('nlu-manager')
          nluManager.settings.spellCheck = true

          await this.nlp.load(nlpModel)
          log.success('NLP model loaded')

          this.ner = new Ner(this.nlp.ner)

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
   * Classify the utterance,
   * pick-up the right classification
   * and extract entities
   * TODO: split this method into several methods
   */
  process (utterance, opts) {
    const processingTimeStart = Date.now()

    return new Promise(async (resolve, reject) => {
      log.title('NLU')
      log.info('Processing...')

      opts = opts || {
        mute: false // Close Leon mouth e.g. over HTTP
      }
      utterance = string.ucfirst(utterance)

      if (Object.keys(this.nlp).length === 0) {
        if (!opts.mute) {
          this.brain.talk(`${this.brain.wernicke('random_errors')}!`)
          this.brain.socket.emit('is-typing', false)
        }

        const msg = 'The NLP model is missing, please rebuild the project or if you are in dev run: npm run train'
        log.error(msg)
        return reject(msg)
      }

      // Add spaCy entities
      const spacyEntities = await Ner.getSpacyEntities(utterance)
      if (spacyEntities.length > 0) {
        spacyEntities.forEach(({ entity, resolution }) => {
          const spacyEntity = {
            [entity]: {
              options: {
                [resolution.value]: [resolution.value]
              }
            }
          }

          this.nlp.addEntities(spacyEntity, this.brain.lang)
        })
      }

      // TODO: create specific method
      const hasActivatedContext = this.conv.hasActiveContext()
      if (hasActivatedContext) {
        const { domain, intent } = this.conv.activeContext
        const [skillName, actionName] = intent.split('.')
        const nluDataFilePath = join(process.cwd(), 'skills', domain, skillName, `nlu/${this.brain.lang}.json`)
        const nluResultObj = {
          utterance,
          entities: [],
          classification: {
            domain,
            skill: skillName,
            action: actionName
          }
        }
        const entities = await this.ner.extractEntities(
          this.brain.lang,
          nluDataFilePath,
          nluResultObj
        )

        this.conv.setSlots(this.brain.lang, entities)

        // console.log('active context obj', this.conv.activeContext)
        // console.log('nluResultObj', nluResultObj)

        const notFilledSlot = this.conv.getNotFilledSlot()
        /**
         * Loop for questions if a slot hasn't been filled
         * and at least an entity has been found
         */
        if (notFilledSlot && entities.length > 0) {
          this.brain.talk(notFilledSlot.pickedQuestion)
          this.brain.socket.emit('is-typing', false)

          return resolve()
        }

        if (!this.conv.areSlotsAllFilled()) {
          this.brain.talk(`${this.brain.wernicke('random_context_out_of_topic')}.`)
        } else {
          /**
           * TODO:
           * 1. [OK] Extract entities from utterance
           * 2. [OK] If none of them match any slot in the active context, then continue
           * 3. [OK] If an entity match slot in active context, then fill it
           * 4. Move skill type to action type
           * 5. Execute next action (based on input_context?)
           * 6. Split this process() method into several ones
           * 7. Add logs in terminal about context switching, active context, etc.
           */

          const data = await this.brain.execute(nluResultObj, { mute: opts.mute })
          return resolve({
            ...data
          })
        }

        this.conv.cleanActiveContext()
      }

      const result = await this.nlp.process(utterance)
      // console.log('result', result)
      const {
        locale, domain, intent, score, answers
      } = result
      const [skillName, actionName] = intent.split('.')
      let nluResultObj = {
        utterance,
        entities: [],
        answers, // For dialog action type
        classification: {
          domain,
          skill: skillName,
          action: actionName,
          confidence: score
        }
      }

      // Language isn't supported
      if (!lang.getShortLangs().includes(locale)) {
        this.brain.talk(`${this.brain.wernicke('random_language_not_supported')}.`, true)
        this.brain.socket.emit('is-typing', false)
        return resolve({ })
      }

      // Trigger language switch
      if (this.brain.lang !== locale) {
        const connectedHandler = async () => {
          await this.process(utterance)
        }

        this.brain.lang = locale
        this.brain.talk(`${this.brain.wernicke('random_language_switch')}.`, true)

        // Recreate a new TCP server process and reconnect the TCP client
        kill(global.tcpServerProcess.pid, () => {
          global.tcpServerProcess = spawn(`pipenv run python bridges/python/tcp_server/main.py ${locale}`, { shell: true })

          global.tcpClient = new TcpClient(
            process.env.LEON_PY_TCP_SERVER_HOST,
            process.env.LEON_PY_TCP_SERVER_PORT
          )

          global.tcpClient.ee.removeListener('connected', connectedHandler)
          global.tcpClient.ee.on('connected', connectedHandler)
        })

        // Do not continue the NLU process
        return resolve({ })
      }

      /* istanbul ignore next */
      if (process.env.LEON_LOGGER === 'true' && process.env.LEON_NODE_ENV !== 'testing') {
        this.request
          .post('https://logger.getleon.ai/v1/expressions')
          .set('X-Origin', 'leon-core')
          .send({
            version,
            utterance,
            lang: this.brain.lang,
            classification: nluResultObj.classification
          })
          .then(() => { /* */ })
          .catch(() => { /* */ })
      }

      if (intent === 'None') {
        const fallback = Nlu.fallback(nluResultObj, langs[lang.getLongCode(locale)].fallbacks)

        if (fallback === false) {
          if (!opts.mute) {
            this.brain.talk(`${this.brain.wernicke('random_unknown_intents')}.`, true)
            this.brain.socket.emit('is-typing', false)
          }

          log.title('NLU')
          const msg = 'Intent not found'
          log.warning(msg)

          const processingTimeEnd = Date.now()
          const processingTime = processingTimeEnd - processingTimeStart

          return resolve({
            processingTime,
            message: msg
          })
        }

        nluResultObj = fallback
      }

      log.title('NLU')
      log.success(`Intent found: ${nluResultObj.classification.skill}.${nluResultObj.classification.action} (domain: ${nluResultObj.classification.domain})`)

      const nluDataFilePath = join(process.cwd(), 'skills', nluResultObj.classification.domain, nluResultObj.classification.skill, `nlu/${this.brain.lang}.json`)
      const { actions } = JSON.parse(fs.readFileSync(nluDataFilePath, 'utf8'))
      const { type: actionType } = actions[actionName]

      nluResultObj.actionType = actionType

      try {
        nluResultObj.entities = await this.ner.extractEntities(
          this.brain.lang,
          nluDataFilePath,
          nluResultObj
        )
      } catch (e) /* istanbul ignore next */ {
        if (log[e.type]) {
          log[e.type](e.obj.message)
        }

        if (!opts.mute) {
          this.brain.talk(`${this.brain.wernicke(e.code, '', e.data)}!`)
        }
      }

      const slots = await this.nlp.slotManager.getMandatorySlots(intent)
      this.conv.setContext({
        lang: this.brain.lang,
        slots,
        nluDataFilePath,
        actionName,
        domain,
        intent,
        entities: nluResultObj.entities
      })

      const notFilledSlot = this.conv.getNotFilledSlot()
      // Loop for questions if a slot hasn't been filled
      if (notFilledSlot) {
        this.brain.talk(notFilledSlot.pickedQuestion)
        this.brain.socket.emit('is-typing', false)

        return resolve()
      }

      try {
        // Inject action entities with the others if there is
        const data = await this.brain.execute(nluResultObj, { mute: opts.mute })
        const processingTimeEnd = Date.now()
        const processingTime = processingTimeEnd - processingTimeStart

        return resolve({
          processingTime, // In ms, total time
          ...data,
          nluProcessingTime:
            processingTime - data?.executionTime // In ms, NLU processing time only
        })
      } catch (e) /* istanbul ignore next */ {
        log[e.type](e.obj.message)

        if (!opts.mute) {
          this.brain.socket.emit('is-typing', false)
        }

        return reject(e.obj)
      }
    })
  }

  /**
   * Pickup and compare the right fallback
   * according to the wished skill action
   */
  static fallback (nluResultObj, fallbacks) {
    const words = nluResultObj.utterance.toLowerCase().split(' ')

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
          nluResultObj.entities = []
          nluResultObj.classification.domain = fallbacks[i].domain
          nluResultObj.classification.skill = fallbacks[i].skill
          nluResultObj.classification.action = fallbacks[i].action
          nluResultObj.classification.confidence = 1

          log.success('Fallback found')
          return nluResultObj
        }
      }
    }

    return false
  }
}

export default Nlu
