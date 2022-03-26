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
import domainHelper from '@/helpers/domain'
import TcpClient from '@/core/tcp-client'

class Nlu {
  constructor (brain) {
    this.brain = brain
    this.request = request
    this.nlp = { }
    this.ner = { }
    this.currentConversation = 'conv0'
    this.maxContextHistory = 5
    this.conversations = {
      conv0: {
        id: 'conv0',
        activeContext: {
          name: null,
          slots: { },
          activatedAt: 0
        },
        previousContexts: { }
      }
    }

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

          container.register('extract-builtin-??', new BuiltinMicrosoft(), true)
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

      const hasActivatedContext = !!this.conversations[this.currentConversation].activeContext.name

      if (hasActivatedContext) {
        /**
         * TODO:
         * 1. Extract entities from utterance
         * 2. If none of them match any slot in the active context, then continue
         * 3. If an entity match slot in active context, then fill it
         */
      }

      console.log('active context obj', this.conversations[this.currentConversation].activeContext)

      const result = await this.nlp.process(utterance)
      console.log('result', result)
      const {
        locale, domain, intent, score, answers
      } = result
      const [skillName, actionName] = intent.split('.')
      let obj = {
        utterance,
        entities: [],
        answers, // For dialog skill type
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
            classification: obj.classification
          })
          .then(() => { /* */ })
          .catch(() => { /* */ })
      }

      if (intent === 'None') {
        const fallback = Nlu.fallback(obj, langs[lang.getLongCode(locale)].fallbacks)

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

        obj = fallback
      }

      log.title('NLU')
      log.success(`Intent found: ${obj.classification.skill}.${obj.classification.action} (domain: ${obj.classification.domain})`)

      const nluDataFilePath = join(process.cwd(), 'skills', obj.classification.domain, obj.classification.skill, `nlu/${this.brain.lang}.json`)
      const { type: skillType } = domainHelper.getSkillInfo(domain, skillName)
      obj.skillType = skillType

      try {
        obj.entities = await this.ner.extractEntities(
          this.brain.lang,
          nluDataFilePath,
          obj
        )
      } catch (e) /* istanbul ignore next */ {
        if (log[e.type]) {
          log[e.type](e.obj.message)
        }

        if (!opts.mute) {
          this.brain.talk(`${this.brain.wernicke(e.code, '', e.data)}!`)
        }
      }

      // TODO: create specific method for that
      const setContext = async (domain, intent, entities) => {
        const slots = await this.nlp.slotManager.getMandatorySlots(intent)
        const slotKeys = Object.keys(slots)

        // If slots are required to trigger next actions, then go through the context activation
        if (slotKeys.length > 0) {
          // Grab output context from the NLU data file
          const { actions } = JSON.parse(fs.readFileSync(nluDataFilePath, 'utf8'))
          const { output_context: outputContext } = actions[actionName]
          const activeContextName = this.conversations[this.currentConversation].activeContext.name

          /**
           * If there is an active context and a new one is triggered
           * then save the current active context to the contexts history
           */
          if (activeContextName && activeContextName !== outputContext) {
            this.conversations[this.currentConversation]
              .previousContexts[activeContextName] = this.conversations[this.currentConversation]
              .activeContext
            // TODO: maxContextHistory
          } else if (!activeContextName) {
            // Activate new context
            this.conversations[this.currentConversation].activeContext.name = outputContext
            this.conversations[this.currentConversation].activeContext.activatedAt = Date.now()
          }

          console.log('this.conversations', this.conversations)

          for (let i = 0; i < slotKeys.length; i += 1) {
            const key = slotKeys[i]
            const slotObj = slots[key]
            const [slotName, slotEntity] = key.split('#')
            const [foundEntity] = entities.filter(({ entity }) => entity === slotEntity)
            const questions = slotObj.locales[this.brain.lang]
            const question = questions[Math.floor(Math.random() * questions.length)]
            const slot = this.conversations[this.currentConversation].activeContext.slots[slotName]
            const newSlot = {
              name: slotName,
              domain,
              intent,
              entity: slotEntity,
              value: foundEntity,
              isFilled: !!foundEntity,
              question
            }

            /**
             * When the slot isn't set or not filled yet
             * or if it already set but the value has changed
             * then set the slot
             */
            if (!slot || !slot.isFilled
              || (slot.isFilled && newSlot.isFilled
                && slot.value.resolution.value !== newSlot.value.resolution.value)
            ) {
              this.conversations[this.currentConversation].activeContext.slots[slotName] = newSlot
            }
          }
        }
      }

      await setContext(domain, intent, obj.entities)
      console.log('slots', this.conversations[this.currentConversation].activeContext.slots)
      const slotsKeys = Object.keys(
        this.conversations[this.currentConversation].activeContext.slots
      )
      const [notFilledSlotKey] = slotsKeys
        .filter((slotKey) => !this.conversations[this.currentConversation]
          .activeContext.slots[slotKey].isFilled)
      const notFilledSlot = this.conversations[this.currentConversation]
        .activeContext.slots[notFilledSlotKey]

      // Loop questions if all the slots haven't been filled
      if (notFilledSlot) {
        this.brain.talk(notFilledSlot.question)
        this.brain.socket.emit('is-typing', false)

        return resolve()
      }

      console.log('this.conversations[this.currentConversation].activeContext.slots', this.conversations[this.currentConversation].activeContext.slots)

      // return resolve()

      // TODO: fill with contexts?
      // obj.slots = slots
      // console.log('getIntentEntityNames',
      // await this.nlp.slotManager.getIntentEntityNames(intent))
      // ['number']

      // console.log('getMandatorySlots', await this.nlp.slotManager.getMandatorySlots(intent))
      /*
      number: {
          intent: 'guess_the_number.start',
          entity: 'number',
          mandatory: true,
          locales: { en: [Array] }
        }
       */

      try {
        // Inject action entities with the others if there is
        const data = await this.brain.execute(obj, { mute: opts.mute })
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
  static fallback (obj, fallbacks) {
    const words = obj.utterance.toLowerCase().split(' ')

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
          obj.classification.domain = fallbacks[i].domain
          obj.classification.skill = fallbacks[i].skill
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
