import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { ShortLanguageCode } from '@/types'
import type { GlobalAnswersSchema } from '@/schemas/global-data-schemas'
import type { NLUProcessResult } from '@/core/nlp/types'
import type { SkillAnswerConfigSchema } from '@/schemas/skill-schemas'
import type { BrainProcessResult } from '@/core/brain/types'
import { SkillActionTypes } from '@/core/brain/types'
import { HAS_TTS } from '@/constants'
import {
  CONVERSATION_LOGGER,
  LLM_MANAGER,
  NLU,
  SOCKET_SERVER,
  TTS
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { ParaphraseLLMDuty } from '@/core/llm-manager/llm-duties/paraphrase-llm-duty'
import { AnswerQueue } from '@/core/brain/answer-queue'
import { LogicActionSkillHandler } from '@/core/brain/logic-action-skill-handler'
import { DialogActionSkillHandler } from '@/core/brain/dialog-action-skill-handler'

type SkillProcess = ChildProcessWithoutNullStreams | undefined
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
  private _skillProcess: SkillProcess = undefined
  private _skillFriendlyName = ''
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

  public get skillFriendlyName(): string {
    return this._skillFriendlyName
  }

  public set skillFriendlyName(newSkillFriendlyName: string) {
    this._skillFriendlyName = newSkillFriendlyName
  }

  public get skillProcess(): SkillProcess {
    return this._skillProcess
  }

  public set skillProcess(newSkillProcess: SkillProcess) {
    this._skillProcess = newSkillProcess
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

  // TODO: core rewrite delete?
  /*private shouldAskToRepeat(nluResult: NLUResult): boolean {
    return (
      nluResult.classification.confidence <
      LANG_CONFIGS[LangHelper.getLongCode(this._lang)].min_confidence
    )
  }*/

  // TODO: core rewrite delete?
  /*private handleAskToRepeat(nluResult: NLUResult): void {
    if (!this.isMuted) {
      const speech = `${this.wernicke('random_not_sure')}.`

      this.talk(speech, true)
      SOCKET_SERVER.socket?.emit('ask-to-repeat', nluResult)
    }
  }*/

  /**
   * Run skill action
   */
  public async runSkillAction(
    nluProcessResult: NLUProcessResult
  ): Promise<Partial<BrainProcessResult>> {
    LogHelper.title('Brain')
    LogHelper.info(
      `Running "${nluProcessResult.actionName}" action from "${nluProcessResult.skillName}" skill...`
    )

    const executionTimeStart = Date.now()
    const utteranceId = `${Date.now()}-${StringHelper.random(4)}`
    const actionType = nluProcessResult.actionConfig?.type

    // Reset skill output
    this.skillOutput = ''

    console.log('nluProcessResult', nluProcessResult)

    const actionTypeHandlers = {
      [SkillActionTypes.Logic]: (
        nluProcessResult: NLUProcessResult
      ): Promise<Partial<BrainProcessResult>> => {
        return LogicActionSkillHandler.handle(nluProcessResult, utteranceId)
      },
      [SkillActionTypes.Dialog]: (
        nluProcessResult: NLUProcessResult
      ): Promise<Partial<BrainProcessResult>> => {
        return DialogActionSkillHandler.handle(nluProcessResult, utteranceId)
      }
    }

    try {
      const brainExecutionResult =
        await actionTypeHandlers[actionType as SkillActionTypes](
          nluProcessResult
        )

      const executionTimeEnd = Date.now()
      const executionTime = executionTimeEnd - executionTimeStart

      return {
        ...brainExecutionResult,
        executionTime // In ms, skill execution time only
      }
    } catch (e) {
      const executionTimeEnd = Date.now()
      const executionTime = executionTimeEnd - executionTimeStart

      LogHelper.title('Brain')
      LogHelper.error(
        `Failed to run "${nluProcessResult.actionName}" action from "${
          nluProcessResult.skillName
        }" skill: ${String(e)}`
      )

      this.speakSkillError()

      return {
        executionTime
      }
    }
  }

  /**
   * Speak about an error happened regarding a specific skill
   */
  public speakSkillError(): void {
    const speech = `${this.wernicke('random_skill_errors', '', {
      '{{ skill_name }}': this._skillFriendlyName
    })}!`

    if (!this.isMuted) {
      this.talk(speech)
    }
  }
}
