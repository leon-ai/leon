import fs from 'node:fs'
import path from 'node:path'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

import type { ShortLanguageCode } from '@/types'
import type { GlobalAnswersSchema } from '@/schemas/global-data-schemas'
import type {
  CustomEnumEntity,
  NERCustomEntity,
  NLUResult
} from '@/core/nlp/types'
import type {
  SkillAnswerConfigSchema,
  SkillConfigSchema,
  SkillSchema
} from '@/schemas/skill-schemas'
import type {
  BrainProcessResult,
  IntentObject,
  SkillResult
} from '@/core/brain/types'
import type { AnswerOutput } from '@sdk/types'
import { SkillActionTypes, SkillBridges } from '@/core/brain/types'
import {
  HAS_TTS,
  PYTHON_BRIDGE_BIN_PATH,
  NODEJS_BRIDGE_BIN_PATH,
  TMP_PATH,
  LANG_CONFIGS
} from '@/constants'
import {
  CONVERSATION_LOGGER,
  LLM_MANAGER,
  NLU,
  SOCKET_SERVER,
  TTS
} from '@/core'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { StringHelper } from '@/helpers/string-helper'
import { DateHelper } from '@/helpers/date-helper'
import { ParaphraseLLMDuty } from '@/core/llm-manager/llm-duties/paraphrase-llm-duty'
import { AnswerQueue } from '@/core/brain/answer-queue'

interface IsTalkingWithVoiceOptions {
  shouldInterrupt?: boolean
}

const MIN_NB_OF_WORDS_TO_USE_LLM_NLG = 5

export default class Brain {
  private static instance: Brain
  private _lang: ShortLanguageCode = 'en'
  private _isTalkingWithVoice = false
  private answerQueue = new AnswerQueue<SkillAnswerConfigSchema>()
  private answerQueueProcessTimerId: NodeJS.Timeout | undefined = undefined
  private broca: GlobalAnswersSchema = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'core', 'data', this._lang, 'answers.json'),
      'utf8'
    )
  )
  private skillProcess: ChildProcessWithoutNullStreams | undefined = undefined
  private domainFriendlyName = ''
  private skillFriendlyName = ''
  public skillOutput = ''
  public isMuted = false // Close Leon mouth if true; e.g. over HTTP

  constructor() {
    if (!Brain.instance) {
      LogHelper.title('Brain')
      LogHelper.success('New instance')

      Brain.instance = this

      /**
       * Clean up the answer queue every 2 hours
       * to avoid memory leaks
       */
      setInterval(
        () => {
          if (this.answerQueueProcessTimerId) {
            this.cleanUpAnswerQueueTimer()
            this.answerQueue.clear()
          }
        },
        60_000 * 60 * 2
      )
    }
  }

  public get isTalkingWithVoice(): boolean {
    return this._isTalkingWithVoice
  }

  public setIsTalkingWithVoice(
    isTalkingWithVoice: boolean,
    options?: IsTalkingWithVoiceOptions
  ): void {
    options = options || {
      shouldInterrupt: false
    }

    if (HAS_TTS) {
      LogHelper.title('Brain')

      if (
        this._isTalkingWithVoice &&
        !isTalkingWithVoice &&
        options.shouldInterrupt
      ) {
        // Tell client to interrupt the current speech
        SOCKET_SERVER.socket?.emit('tts-interruption')
        // Cancel all the future speeches
        TTS.speeches = []
        LogHelper.info('Leon got interrupted')
      }

      if (isTalkingWithVoice) {
        LogHelper.info('Leon is talking with voice')
      } else {
        LogHelper.info('Leon stopped talking with voice')
      }
    }

    this._isTalkingWithVoice = isTalkingWithVoice
  }

  public get lang(): ShortLanguageCode {
    return this._lang
  }

  public set lang(newLang: ShortLanguageCode) {
    this._lang = newLang
    // Update broca
    this.broca = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'core', 'data', this._lang, 'answers.json'),
        'utf8'
      )
    )

    if (HAS_TTS) {
      this.updateTTSLang(this._lang)
    }
  }

  /**
   * Clean up the answer queue timer to avoid multiple timers running
   */
  private cleanUpAnswerQueueTimer(intervalId?: NodeJS.Timeout): void {
    const intervalToCleanUp = intervalId
      ? intervalId
      : this.answerQueueProcessTimerId

    clearInterval(intervalToCleanUp)

    if (intervalToCleanUp === this.answerQueueProcessTimerId) {
      this.answerQueueProcessTimerId = undefined
    }
  }

  /**
   * Process the answer queue in the right order (first in, first out)
   */
  private async processAnswerQueue(end = false): Promise<void> {
    // Between 100 and 350ms
    const naturalStartTypingDelay = Math.floor(
      Math.random() * (350 - 100 + 1) + 100
    )
    this.answerQueue.isProcessing = true

    // Clean up the timer as we are now already processing the queue for this timer tick
    if (this.answerQueueProcessTimerId) {
      this.cleanUpAnswerQueueTimer()
    }
    for (let i = 0; i < this.answerQueue.answers.length; i += 1) {
      /**
       * Use setTimeout to have a more natural feeling that
       * Leon is starting to type another message just after sending the previous one
       */
      setTimeout(() => {
        SOCKET_SERVER.socket?.emit('is-typing', true)
      }, naturalStartTypingDelay)
      // Next answer to handle
      const answer = this.answerQueue.pop()
      let textAnswer: string | undefined = ''
      let speechAnswer = ''

      if (answer && answer !== '') {
        textAnswer = typeof answer === 'string' ? answer : answer.text
        speechAnswer = typeof answer === 'string' ? answer : answer.speech

        const { actionConfig: currentActionConfig } = NLU.nluResult
        const hasLoopConfig = !!currentActionConfig?.loop
        const hasSlotsConfig = !!currentActionConfig?.slots
        const isLLMNLGDisabled = !!currentActionConfig?.disable_llm_nlg

        /**
         * Only use LLM NLG if:
         * - It is not specifically disabled in the action config
         * - It is enabled in general
         * - The current action does not have a loop neither slots configuration
         * (Because sometimes the LLM will not be able to generate a meaningful text,
         * and it will mislead the conversation)
         */
        if (
          !isLLMNLGDisabled &&
          LLM_MANAGER.isLLMNLGEnabled &&
          !hasLoopConfig &&
          !hasSlotsConfig
        ) {
          if (
            speechAnswer === textAnswer ||
            typeof answer === 'string' ||
            answer.speech
          ) {
            /**
             * Only use LLM NLG if the answer is not too short
             * otherwise it will be too hard for the model to generate a meaningful text
             */
            const textToParaphrase = textAnswer ?? speechAnswer
            const nbOfWords = String(textToParaphrase).split(' ').length
            if (nbOfWords >= MIN_NB_OF_WORDS_TO_USE_LLM_NLG) {
              const paraphraseDuty = new ParaphraseLLMDuty({
                input: textToParaphrase
              })
              await paraphraseDuty.init()
              const paraphraseResult = await paraphraseDuty.execute({
                // Do not generate tokens when only a speech answer is needed
                shouldEmitOnToken: !!(!textAnswer && speechAnswer)
              })

              if (!textAnswer) {
                speechAnswer = paraphraseResult?.output as unknown as string
              } else {
                textAnswer = paraphraseResult?.output as unknown as string
                speechAnswer = textAnswer
              }
            }
          }
        }

        if (HAS_TTS) {
          // Stripe HTML to a whitespace. Whitespace to let the TTS respects punctuation
          const speech = speechAnswer.replace(/<(?:.|\n)*?>/gm, ' ')

          TTS.add(speech, end)
        }

        /**
         * Unify stream feeling for all answers.
         * But need to ensure that tokens aren't already sent via the onToken
         * callback on the completion. Can check with LLM_PROVIDER to implement
         * a mechanism to avoid sending the same tokens twice
         */
        /*const generationId = StringHelper.random(6, { onlyLetters: true })
        const tokens = textAnswer.split(' ')
        tokens.forEach((token) => {
          SOCKET_SERVER.socket?.emit('llm-token', {
            token,
            generationId
          })
        })*/

        /**
         * Only send an answer when the text answer is defined.
         * It may happen that only a speech is needed
         */
        if (textAnswer) {
          SOCKET_SERVER.socket?.emit('answer', textAnswer)

          await CONVERSATION_LOGGER.push({
            who: 'owner',
            message: NLU.nluResult.newUtterance
          })
          await CONVERSATION_LOGGER.push({
            who: 'leon',
            message: textAnswer
          })
        }

        // SOCKET_SERVER.socket?.emit('is-typing', false)
      }
    }

    /**
     * In case new answers have been added answers in the queue while
     * the queue was being processed, process them
     */
    if (!this.answerQueue.isEmpty()) {
      LogHelper.title('Brain')
      LogHelper.info(
        `Answers have been processed. But ${this.answerQueue.answers.length} new answers have been added to the queue while the queue was being processed. Processing them now...`
      )
      await this.processAnswerQueue(end)
    }

    this.answerQueue.isProcessing = false
    setTimeout(() => {
      SOCKET_SERVER.socket?.emit('is-typing', false)
    }, naturalStartTypingDelay)
  }

  private async updateTTSLang(newLang: ShortLanguageCode): Promise<void> {
    await TTS.init(newLang)

    LogHelper.title('Brain')
    LogHelper.info('Language has changed')
  }

  /**
   * Delete intent object file
   */
  private static deleteIntentObjFile(intentObjectPath: string): void {
    try {
      if (fs.existsSync(intentObjectPath)) {
        fs.unlinkSync(intentObjectPath)
      }
    } catch (e) {
      LogHelper.error(`Failed to delete intent object file: ${e}`)
    }
  }

  /**
   * Make Leon talk by adding the answer to the answer queue
   */
  public async talk(
    answer: SkillAnswerConfigSchema,
    end = false
  ): Promise<void> {
    LogHelper.title('Brain')
    LogHelper.info('Talking...')

    if (!answer) {
      LogHelper.warning('No answer to say')
      return
    }

    this.answerQueue.push(answer)
    /**
     * If the answer queue is not processing and not empty,
     * then process the queue,
     * otherwise clean up the new answer queue timer right away to not have multiple timers running
     */
    const answerTimerCheckerId = setInterval(() => {
      if (!this.answerQueue.isProcessing && !this.answerQueue.isEmpty()) {
        this.processAnswerQueue(end)
      } else {
        this.cleanUpAnswerQueueTimer(answerTimerCheckerId)
      }
    }, 300)
    this.answerQueueProcessTimerId = answerTimerCheckerId
  }

  /**
   * Pickup speech info we need to return
   */
  public wernicke(
    type: string,
    key?: string,
    obj?: Record<string, unknown>
  ): string {
    let answerObject: Record<string, string> = {}
    let answer = ''

    // Choose a random answer or a specific one
    let property = this.broca.answers[type]
    if (property?.constructor === [].constructor) {
      property = property as string[]
      answer = property[Math.floor(Math.random() * property.length)] as string
    } else {
      answerObject = property as Record<string, string>
    }

    // Select a specific key
    if (key !== '' && typeof key !== 'undefined') {
      answer = answerObject[key] as string
    }

    // Parse sentence's value(s) and replace with the given object
    if (typeof obj !== 'undefined' && Object.keys(obj).length > 0) {
      answer = StringHelper.findAndMap(answer, obj)
    }

    return answer
  }

  private shouldAskToRepeat(nluResult: NLUResult): boolean {
    return (
      nluResult.classification.confidence <
      LANG_CONFIGS[LangHelper.getLongCode(this._lang)].min_confidence
    )
  }

  private handleAskToRepeat(nluResult: NLUResult): void {
    if (!this.isMuted) {
      const speech = `${this.wernicke('random_not_sure')}.`

      this.talk(speech, true)
      SOCKET_SERVER.socket?.emit('ask-to-repeat', nluResult)
    }
  }

  /**
   * Create the intent object that will be passed to the skill
   */
  private createIntentObject(
    nluResult: NLUResult,
    utteranceID: string,
    slots: IntentObject['slots']
  ): IntentObject {
    const date = DateHelper.getDateTime()
    const dateObject = new Date(date)

    return {
      id: utteranceID,
      lang: this._lang, // TODO: remove once the Python bridge will be updated to use extra_context_data.lang instead
      domain: nluResult.classification.domain,
      skill: nluResult.classification.skill,
      action: nluResult.classification.action,
      utterance: nluResult.utterance,
      new_utterance: nluResult.newUtterance,
      current_entities: nluResult.currentEntities,
      entities: nluResult.entities,
      current_resolvers: nluResult.currentResolvers,
      resolvers: nluResult.resolvers,
      slots,
      extra_context_data: {
        lang: this._lang,
        sentiment: nluResult.sentiment,
        date: date.slice(0, 10),
        time: date.slice(11, 19),
        timestamp: dateObject.getTime(),
        date_time: date,
        week_day: dateObject.toLocaleString('default', { weekday: 'long' })
      }
    }
  }

  /**
   * Handle the skill process output
   */
  private handleLogicActionSkillProcessOutput(
    data: Buffer
  ): Promise<Error | null> | void {
    SOCKET_SERVER.socket?.emit('is-typing', true)

    try {
      const skillAnswer = JSON.parse(data.toString()) as AnswerOutput

      if (typeof skillAnswer === 'object') {
        LogHelper.title(`${this.skillFriendlyName} skill (on data)`)
        LogHelper.info(data.toString())

        if (skillAnswer.output.widget && !this.isMuted) {
          try {
            SOCKET_SERVER.socket?.emit(
              'widget',
              JSON.stringify(skillAnswer.output.widget)
            )
          } catch (e) {
            LogHelper.title('Brain')
            LogHelper.error(
              `Failed to send widget. Widget output is not well formatted: ${e}`
            )
          } finally {
            // Stop typing when the widget is sent
            SOCKET_SERVER.socket?.emit('is-typing', false)
          }
        }

        const { answer } = skillAnswer.output
        if (!this.isMuted) {
          this.talk(answer, true)
        }
        this.skillOutput = data.toString()

        return Promise.resolve(null)
      } else {
        return Promise.reject(
          new Error(
            `The "${this.skillFriendlyName}" skill from the "${this.domainFriendlyName}" domain is not well configured. Check the configuration file.`
          )
        )
      }
    } catch (e) {
      LogHelper.title('Brain')
      LogHelper.debug(`process.stdout: ${String(data)}. Details: ${e}`)
    }
  }

  /**
   * Speak about an error happened regarding a specific skill
   */
  private speakSkillError(): void {
    const speech = `${this.wernicke('random_skill_errors', '', {
      '%skill_name%': this.skillFriendlyName,
      '%domain_name%': this.domainFriendlyName
    })}!`

    if (!this.isMuted) {
      this.talk(speech)
    }
  }

  /**
   * Handle the skill process error
   */
  private handleLogicActionSkillProcessError(
    data: Buffer,
    intentObjectPath: string
  ): Error {
    this.speakSkillError()

    Brain.deleteIntentObjFile(intentObjectPath)

    LogHelper.title(`${this.skillFriendlyName} skill`)
    LogHelper.error(data.toString())

    return new Error(data.toString())
  }

  /**
   * Execute an action logic skill in a standalone way (CLI):
   *
   * 1. Need to be at the root of the project
   * 2. Edit: server/src/intent-object.sample.json
   * 3. Run: npm run python-bridge
   */
  private async executeLogicActionSkill(
    nluResult: NLUResult,
    skillBridge: SkillSchema['bridge'],
    utteranceID: string,
    intentObjectPath: string
  ): Promise<void> {
    // Ensure the process is empty (to be able to execute other processes outside of Brain)
    if (!this.skillProcess) {
      const slots: IntentObject['slots'] = {}

      if (nluResult.slots) {
        Object.keys(nluResult.slots)?.forEach((slotName) => {
          slots[slotName] = nluResult.slots[slotName]?.value
        })
      }

      const intentObject = this.createIntentObject(
        nluResult,
        utteranceID,
        slots
      )

      try {
        await fs.promises.writeFile(
          intentObjectPath,
          JSON.stringify(intentObject)
        )

        if (skillBridge === SkillBridges.Python) {
          this.skillProcess = spawn(
            `${PYTHON_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
            { shell: true }
          )
        } else if (skillBridge === SkillBridges.NodeJS) {
          this.skillProcess = spawn(
            `${NODEJS_BRIDGE_BIN_PATH} "${intentObjectPath}"`,
            { shell: true }
          )
        } else {
          LogHelper.error(`The skill bridge is not supported: ${skillBridge}`)
        }
      } catch (e) {
        LogHelper.error(`Failed to save intent object: ${e}`)
      }
    }
  }

  /**
   * Execute skills
   */
  public execute(nluResult: NLUResult): Promise<Partial<BrainProcessResult>> {
    const executionTimeStart = Date.now()

    return new Promise(async (resolve) => {
      const utteranceID = `${Date.now()}-${StringHelper.random(4)}`
      const intentObjectPath = path.join(TMP_PATH, `${utteranceID}.json`)
      const speeches: string[] = []

      // Reset skill output
      this.skillOutput = ''

      // Ask to repeat if Leon is not sure about the request
      if (this.shouldAskToRepeat(nluResult)) {
        this.handleAskToRepeat(nluResult)

        const executionTimeEnd = Date.now()
        const executionTime = executionTimeEnd - executionTimeStart

        resolve({
          speeches,
          executionTime
        })
      } else {
        const {
          skillConfigPath,
          classification: { action: actionName }
        } = nluResult
        const { actions } = await SkillDomainHelper.getSkillConfig(
          skillConfigPath,
          this._lang
        )
        const action = actions[
          actionName
        ] as SkillConfigSchema['actions'][string]
        const { type: actionType } = action
        const nextAction = action.next_action
          ? actions[action.next_action]
          : null

        if (actionType === SkillActionTypes.Logic) {
          /**
           * "Logic" action skill execution
           */

          const domainName = nluResult.classification.domain
          const skillName = nluResult.classification.skill
          const { name: domainFriendlyName } =
            await SkillDomainHelper.getSkillDomainInfo(domainName)
          const { name: skillFriendlyName, bridge: skillBridge } =
            await SkillDomainHelper.getSkillInfo(domainName, skillName)

          await this.executeLogicActionSkill(
            nluResult,
            skillBridge,
            utteranceID,
            intentObjectPath
          )

          this.domainFriendlyName = domainFriendlyName
          this.skillFriendlyName = skillFriendlyName

          // Read skill output
          this.skillProcess?.stdout.on('data', (data: Buffer) => {
            this.handleLogicActionSkillProcessOutput(data)
          })

          // Handle error
          this.skillProcess?.stderr.on('data', (data: Buffer) => {
            this.handleLogicActionSkillProcessError(data, intentObjectPath)
          })

          // Catch the end of the skill execution
          this.skillProcess?.stdout.on('end', () => {
            LogHelper.title(`${this.skillFriendlyName} skill (on end)`)
            LogHelper.info(this.skillOutput)

            let skillResult: SkillResult | undefined = undefined

            // Check if there is an output (no skill error)
            if (this.skillOutput !== '') {
              try {
                skillResult = JSON.parse(this.skillOutput)
              } catch (e) {
                LogHelper.title(`${this.skillFriendlyName} skill`)
                LogHelper.error(
                  `There is an error on the final output: ${String(e)}`
                )

                this.speakSkillError()
              }
            }

            Brain.deleteIntentObjFile(intentObjectPath)

            const executionTimeEnd = Date.now()
            const executionTime = executionTimeEnd - executionTimeStart

            // Send suggestions to the client
            if (
              nextAction?.suggestions &&
              skillResult?.output.core?.showNextActionSuggestions
            ) {
              SOCKET_SERVER.socket?.emit('suggest', nextAction.suggestions)
            }
            if (
              action?.suggestions &&
              skillResult?.output.core?.showSuggestions
            ) {
              SOCKET_SERVER.socket?.emit('suggest', action.suggestions)
            }

            resolve({
              utteranceID,
              lang: this._lang,
              ...nluResult,
              speeches,
              core: skillResult?.output.core,
              action,
              nextAction,
              executionTime // In ms, skill execution time only
            })
          })

          // Reset the child process
          this.skillProcess = undefined
        } else {
          /**
           * "Dialog" action skill execution
           */

          const configFilePath = path.join(
            process.cwd(),
            'skills',
            nluResult.classification.domain,
            nluResult.classification.skill,
            'config',
            this._lang + '.json'
          )
          const { actions, entities: skillConfigEntities } =
            await SkillDomainHelper.getSkillConfig(configFilePath, this._lang)
          const utteranceHasEntities = nluResult.entities.length > 0
          const utteranceHasSlots = Object.keys(nluResult.slots).length > 0
          const { answers: rawAnswers } = nluResult
          // TODO: handle dialog action skill speech vs text
          // let answers = rawAnswers as [{ answer: SkillAnswerConfigSchema }]
          let answers = rawAnswers
          let answer: string | undefined = ''

          if (!utteranceHasSlots && !utteranceHasEntities) {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') === -1
            )
          } else {
            answers = answers.filter(
              ({ answer }) => answer.indexOf('{{') !== -1
            )
          }

          // When answers are simple without required entity
          if (answers.length === 0) {
            answer =
              rawAnswers[Math.floor(Math.random() * rawAnswers.length)]?.answer

            // In case the expected answer requires a known entity
            if (answer?.indexOf('{{') !== -1) {
              // TODO
              const unknownAnswers =
                actions[nluResult.classification.action]?.unknown_answers

              if (unknownAnswers) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                answer =
                  unknownAnswers[
                    Math.floor(Math.random() * unknownAnswers.length)
                  ]
              }
            }
          } else {
            answer = answers[Math.floor(Math.random() * answers.length)]?.answer

            /**
             * In case the utterance contains slots or entities, and the picked up answer too,
             * then map them (utterance <-> answer)
             */
            if (
              (utteranceHasSlots || utteranceHasEntities) &&
              answer?.indexOf('{{') !== -1
            ) {
              /**
               * Normalize data to browse (entities and slots)
               */
              const dataToBrowse = [
                ...nluResult.currentEntities,
                ...nluResult.entities,
                ...Object.values(nluResult.slots).map((slot) => ({
                  ...slot.value,
                  entity: slot.name
                }))
              ]

              dataToBrowse.forEach((entityObj) => {
                answer = StringHelper.findAndMap(answer as string, {
                  [`{{ ${entityObj.entity} }}`]: (entityObj as NERCustomEntity)
                    .resolution.value
                })

                /**
                 * Find matches and map deeper data from the NLU file (global entities)
                 * TODO: handle more entity types, not only enums for global entities?
                 */
                const matches = answer.match(/{{.+?}}/g)

                matches?.forEach((match) => {
                  let newStr = match.substring(3)

                  newStr = newStr.substring(0, newStr.indexOf('}}') - 1)

                  const [entity, dataKey] = newStr.split('.')

                  if (entity && dataKey && entity === entityObj.entity) {
                    const { option } = entityObj as CustomEnumEntity

                    const entityOption =
                      skillConfigEntities[entity]?.options[option]
                    const entityOptionData = entityOption?.data
                    let valuesArr: string[] = []

                    if (entityOptionData) {
                      // e.g. entities.color.options.red.data.hexa[]
                      valuesArr = entityOptionData[dataKey] as string[]
                    }

                    if (valuesArr.length > 0) {
                      answer = StringHelper.findAndMap(answer as string, {
                        [match]:
                          valuesArr[
                            Math.floor(Math.random() * valuesArr.length)
                          ]
                      })
                    }
                  }
                })
              })
            }
          }

          const executionTimeEnd = Date.now()
          const executionTime = executionTimeEnd - executionTimeStart

          if (!this.isMuted) {
            this.talk(answer as string, true)
          }

          // Send suggestions to the client
          if (nextAction?.suggestions) {
            SOCKET_SERVER.socket?.emit('suggest', nextAction.suggestions)
          }

          resolve({
            utteranceID,
            lang: this._lang,
            ...nluResult,
            speeches: [answer as string],
            core: {},
            action,
            nextAction,
            executionTime // In ms, skill execution time only
          })
        }
      }
    })
  }
}
