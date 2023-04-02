import { join } from 'node:path'
import { spawn } from 'node:child_process'

import kill from 'tree-kill'

import type { Language, ShortLanguageCode } from '@/types'
import type { NLPAction, NLPDomain, NLPJSProcessResult, NLPSkill, NLPUtterance, NLUResult } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import { langs } from '@@/core/langs.json'
import { TCP_SERVER_BIN_PATH } from '@/constants'
import { TCP_CLIENT, BRAIN, SOCKET_SERVER, MODEL_LOADER, NER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { ActionLoop } from '@/core/nlp/nlu/action-loop'
import { SlotFilling } from '@/core/nlp/nlu/slot-filling'
import Conversation, { DEFAULT_ACTIVE_CONTEXT } from '@/core/nlp/conversation'

type NLUProcessResult = Promise<
  Partial<
    BrainProcessResult & {
      processingTime: number
      nluProcessingTime: number
    }
  > | null
>

export const DEFAULT_NLU_RESULT = {
  utterance: '',
  currentEntities: [],
  entities: [],
  currentResolvers: [],
  resolvers: [],
  slots: {},
  skillConfigPath: '',
  answers: [], // For dialog action type
  classification: {
    domain: '',
    skill: '',
    action: '',
    confidence: 0
  }
}

export default class NLU {
  private static instance: NLU
  public nluResult: NLUResult = DEFAULT_NLU_RESULT
  public conversation = new Conversation('conv0')

  constructor() {
    if (!NLU.instance) {
      LogHelper.title('NLU')
      LogHelper.success('New instance')

      NLU.instance = this
    }
  }

  /**
   * Set new language; recreate a new TCP server with new language; and reprocess understanding
   */
  private switchLanguage(
    utterance: NLPUtterance,
    locale: ShortLanguageCode
  ): void {
    const connectedHandler = async (): Promise<void> => {
      await this.process(utterance)
    }

    BRAIN.lang = locale
    BRAIN.talk(`${BRAIN.wernicke('random_language_switch')}.`, true)

    // Recreate a new TCP server process and reconnect the TCP client
    kill(global.tcpServerProcess.pid as number, () => {
      global.tcpServerProcess = spawn(`${TCP_SERVER_BIN_PATH} ${locale}`, {
        shell: true
      })

      TCP_CLIENT.connect()
      TCP_CLIENT.ee.removeListener('connected', connectedHandler)
      TCP_CLIENT.ee.on('connected', connectedHandler)
    })
  }

  /**
   * Classify the utterance,
   * pick-up the right classification
   * and extract entities
   */
  public process(
    utterance: NLPUtterance
  ): NLUProcessResult {
    const processingTimeStart = Date.now()

    return new Promise(async (resolve, reject) => {
      LogHelper.title('NLU')
      LogHelper.info('Processing...')

      if (!MODEL_LOADER.hasNlpModels()) {
        if (!BRAIN.isMuted) {
          BRAIN.talk(`${BRAIN.wernicke('random_errors')}!`)
          SOCKET_SERVER.socket.emit('is-typing', false)
        }

        const msg =
          'An NLP model is missing, please rebuild the project or if you are in dev run: npm run train'
        LogHelper.error(msg)
        return reject(msg)
      }

      // Add spaCy entities
      await NER.mergeSpacyEntities(utterance)

      // Pre NLU processing according to the active context if there is one
      if (this.conversation.hasActiveContext()) {
        // When the active context is in an action loop, then directly trigger the action
        if (this.conversation.activeContext.isInActionLoop) {
          return resolve(await ActionLoop.handle(utterance))
        }

        // When the active context has slots filled
        if (Object.keys(this.conversation.activeContext.slots).length > 0) {
          try {
            return resolve(await SlotFilling.handle(utterance))
          } catch (e) {
            return reject({})
          }
        }
      }

      const result: NLPJSProcessResult = await MODEL_LOADER.mainNLPContainer.process(utterance)
      const { locale, answers, classifications } = result
      let { score, intent, domain } = result

      /**
       * If a context is active, then use the appropriate classification based on score probability.
       * E.g. 1. Create my shopping list; 2. Actually delete it.
       * If there are several "delete it" across skills, Leon needs to make use of
       * the current context ({domain}.{skill}) to define the most accurate classification
       */
      if (this.conversation.hasActiveContext()) {
        classifications.forEach(({ intent: newIntent, score: newScore }) => {
          if (newScore > 0.6) {
            const [skillName] = newIntent.split('.')
            const newDomain = MODEL_LOADER.mainNLPContainer.getIntentDomain(locale, newIntent)
            const contextName = `${newDomain}.${skillName}`
            if (this.conversation.activeContext.name === contextName) {
              score = newScore
              intent = newIntent
              domain = newDomain
            }
          }
        })
      }

      const [skillName, actionName] = intent.split('.')
      this.nluResult = {
        ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
        utterance,
        answers, // For dialog action type
        classification: {
          domain,
          skill: skillName || '',
          action: actionName || '',
          confidence: score
        }
      }

      const isSupportedLanguage = LangHelper.getShortCodes().includes(locale)
      if (!isSupportedLanguage) {
        BRAIN.talk(
          `${BRAIN.wernicke('random_language_not_supported')}.`,
          true
        )
        SOCKET_SERVER.socket.emit('is-typing', false)
        return resolve({})
      }

      // Trigger language switching
      if (BRAIN.lang !== locale) {
        this.switchLanguage(utterance, locale)
        return resolve(null)
      }

      // this.sendLog()

      if (intent === 'None') {
        const fallback = this.fallback(
          langs[LangHelper.getLongCode(locale)].fallbacks
        )

        if (!fallback) {
          if (!BRAIN.isMuted) {
            BRAIN.talk(
              `${BRAIN.wernicke('random_unknown_intents')}.`,
              true
            )
            SOCKET_SERVER.socket.emit('is-typing', false)
          }

          LogHelper.title('NLU')
          const msg = 'Intent not found'
          LogHelper.warning(msg)

          return resolve(null)
        }

        this.nluResult = fallback
      }

      LogHelper.title('NLU')
      LogHelper.success(
        `Intent found: ${this.nluResult.classification.skill}.${this.nluResult.classification.action} (domain: ${this.nluResult.classification.domain})`
      )

      const skillConfigPath = join(
        process.cwd(),
        'skills',
        this.nluResult.classification.domain,
        this.nluResult.classification.skill,
        'config',
        BRAIN.lang + '.json'
      )
      this.nluResult.skillConfigPath = skillConfigPath

      try {
        this.nluResult.entities = await NER.extractEntities(
          BRAIN.lang,
          skillConfigPath,
          this.nluResult
        )
      } catch (e) {
        LogHelper.error(`Failed to extract entities: ${e}`)
      }

      const shouldSlotLoop = await SlotFilling.route(intent)
      if (shouldSlotLoop) {
        return resolve({})
      }

      // In case all slots have been filled in the first utterance
      if (
        this.conversation.hasActiveContext() &&
        Object.keys(this.conversation.activeContext.slots).length > 0
      ) {
        try {
          return resolve(await SlotFilling.handle(utterance))
        } catch (e) {
          return reject({})
        }
      }

      const newContextName = `${this.nluResult.classification.domain}.${skillName}`
      if (this.conversation.activeContext.name !== newContextName) {
        this.conversation.cleanActiveContext()
      }
      this.conversation.activeContext = {
        ...DEFAULT_ACTIVE_CONTEXT,
        lang: BRAIN.lang,
        slots: {},
        isInActionLoop: false,
        originalUtterance: this.nluResult.utterance,
        skillConfigPath: this.nluResult.skillConfigPath,
        actionName: this.nluResult.classification.action,
        domain: this.nluResult.classification.domain,
        intent,
        entities: this.nluResult.entities
      }
      // Pass current utterance entities to the NLU result object
      this.nluResult.currentEntities =
        this.conversation.activeContext.currentEntities
      // Pass context entities to the NLU result object
      this.nluResult.entities = this.conversation.activeContext.entities

      try {
        const processedData = await BRAIN.execute(this.nluResult)

        // Prepare next action if there is one queuing
        if (processedData.nextAction) {
          this.conversation.cleanActiveContext()
          this.conversation.activeContext = {
            ...DEFAULT_ACTIVE_CONTEXT,
            lang: BRAIN.lang,
            slots: {},
            isInActionLoop: !!processedData.nextAction.loop,
            originalUtterance: processedData.utterance ?? '',
            skillConfigPath: processedData.skillConfigPath || '',
            actionName: processedData.action?.next_action || '',
            domain: processedData.classification?.domain || '',
            intent: `${processedData.classification?.skill}.${processedData.action?.next_action}`,
            entities: []
          }
        }

        const processingTimeEnd = Date.now()
        const processingTime = processingTimeEnd - processingTimeStart

        return resolve({
          processingTime, // In ms, total time
          ...processedData,
          nluProcessingTime: processingTime - (processedData?.executionTime || 0) // In ms, NLU processing time only
        })
      } catch (e) {
        const errorMessage = `Failed to execute action: ${e}`

        LogHelper.error(errorMessage)

        if (!BRAIN.isMuted) {
          SOCKET_SERVER.socket.emit('is-typing', false)
        }

        return reject(new Error(errorMessage))
      }
    })
  }

  /**
   * Pickup and compare the right fallback
   * according to the wished skill action
   */
  private fallback(fallbacks: Language['fallbacks']): NLUResult | null {
    const words = this.nluResult.utterance.toLowerCase().split(' ')

    if (fallbacks.length > 0) {
      LogHelper.info('Looking for fallbacks...')
      const tmpWords = []

      for (let i = 0; i < fallbacks.length; i += 1) {
        for (let j = 0; j < fallbacks[i]!.words.length; j += 1) {
          if (words.includes(fallbacks[i]!.words[j] as string)) {
            tmpWords.push(fallbacks[i]?.words[j])
          }
        }

        if (JSON.stringify(tmpWords) === JSON.stringify(fallbacks[i]?.words)) {
          this.nluResult.entities = []
          this.nluResult.classification.domain = fallbacks[i]?.domain as NLPDomain
          this.nluResult.classification.skill = fallbacks[i]?.skill as NLPSkill
          this.nluResult.classification.action = fallbacks[i]?.action as NLPAction
          this.nluResult.classification.confidence = 1

          LogHelper.success('Fallback found')
          return this.nluResult
        }
      }
    }

    return null
  }
}
