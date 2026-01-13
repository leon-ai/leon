import fs from 'node:fs'
import path from 'node:path'

import type {
  AnswerData,
  AnswerInput,
  AnswerOutput,
  AnswerConfig
} from '@sdk/types'
import { INTENT_OBJECT, SKILL_LOCALE_CONFIG } from '@bridge/constants'
import { WidgetWrapper } from '@sdk/aurora'
import { SUPPORTED_WIDGET_EVENTS } from '@sdk/widget-component'

class Leon {
  private static instance: Leon
  private static globalAnswers = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        'core',
        'data',
        INTENT_OBJECT.lang,
        'answers.json'
      ),
      'utf8'
    )
  ).answers

  constructor() {
    if (!Leon.instance) {
      Leon.instance = this
    }
  }

  /**
   * Injects variables into the answer string
   * @param answer The answer to inject variables into
   * @param data The data to apply
   * @example injectVariables('Hello {{ name }}', { name: 'Leon' }) // 'Hello Leon'
   */
  private injectVariables(
    answer: AnswerConfig,
    data: AnswerData | null
  ): AnswerConfig {
    let finalAnswer = answer

    const applyData = (obj: AnswerData): void => {
      for (const key in obj) {
        if (typeof finalAnswer === 'string') {
          finalAnswer = finalAnswer.replaceAll(`{{ ${key} }}`, String(obj[key]))
        } else {
          if (finalAnswer.text) {
            finalAnswer.text = finalAnswer.text.replaceAll(
              `{{ ${key} }}`,
              String(obj[key])
            )
          }
          if (finalAnswer.speech) {
            finalAnswer.speech = finalAnswer.speech.replaceAll(
              `{{ ${key} }}`,
              String(obj[key])
            )
          }
        }
      }
    }

    if (data) {
      applyData(data)
    }

    if (SKILL_LOCALE_CONFIG.variables) {
      applyData(SKILL_LOCALE_CONFIG.variables)
    }

    return finalAnswer
  }

  /**
   * Apply data to the answer
   * @param answerKey The answer key
   * @param data The data to apply
   * @example setAnswerData('key', { name: 'Leon' })
   */
  public setAnswerData(
    answerKey: string,
    data: AnswerData = null
  ): AnswerConfig {
    try {
      const answers =
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        SKILL_LOCALE_CONFIG.answers?.[answerKey] ??
        SKILL_LOCALE_CONFIG.common_answers?.[answerKey] ??
        Leon.globalAnswers?.[answerKey]

      if (!answers) {
        return answerKey
      }

      const answer = Array.isArray(answers)
        ? answers[Math.floor(Math.random() * answers.length)] ?? ''
        : answers

      return this.injectVariables(answer, data)
    } catch (e) {
      console.error(
        `Error while setting answer data. Please verify that the answer key "${answerKey}" exists in the locale configuration. Details:`,
        e
      )

      throw e
    }
  }

  /**
   * Send an answer to the core
   * @param answerInput The answer input
   * @example answer({ key: 'greet' }) // 'Hello world'
   * @example answer({ key: 'welcome', data: { name: 'Louis' } }) // 'Welcome Louis'
   * @example answer({ key: 'confirm', core: { next_action: 'guess_the_number_skill:set_up' } }) // 'Would you like to retry?'
   * @example answer({ key: 'progress', data: { percentage: 50 }, replaceMessageId: 'progress_msg_123' }) // Replace previous progress message
   */
  public async answer(answerInput: AnswerInput): Promise<string | null> {
    try {
      const answerObject: AnswerOutput = {
        ...INTENT_OBJECT,
        output: {
          codes:
            answerInput.widget && !answerInput.key
              ? 'widget'
              : (answerInput.key as string),
          answer:
            answerInput.key != null
              ? this.setAnswerData(answerInput.key, answerInput.data)
              : '',
          core: answerInput.core,
          replaceMessageId: answerInput.replaceMessageId || null
        }
      }

      if (answerInput.widget) {
        answerObject.output.widget = {
          actionName: `${INTENT_OBJECT.skill_name}:${INTENT_OBJECT.action_name}`,
          widget: answerInput.widget.widget,
          id: answerInput.widget.id,
          onFetch: answerInput.widget.onFetch ?? null,
          componentTree: new WidgetWrapper({
            ...answerInput.widget.wrapperProps,
            children: [answerInput.widget.render()]
          }),
          supportedEvents: SUPPORTED_WIDGET_EVENTS
        }
      }

      // "Temporize" for the data buffer output on the core
      await new Promise((r) => setTimeout(r, 100))

      // Write the answer object to stdout as a JSON string with a newline for brain chunk-by-chunk parsing
      process.stdout.write(JSON.stringify(answerObject) + '\n')

      // Return the message ID for future replacement
      return (
        answerInput.widget?.id ||
        `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      )
    } catch (e) {
      console.error('Error while creating answer:', e)

      return null
    }
  }
}

export const leon = new Leon()
