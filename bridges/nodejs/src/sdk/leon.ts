import type { AnswerData, AnswerInput, AnswerOutput } from '@sdk/types'
import {
  INTENT_OBJECT,
  SKILL_CONFIG,
  SKILL_SRC_CONFIG
} from '@bridge/constants'

class Leon {
  private static instance: Leon

  constructor() {
    if (!Leon.instance) {
      Leon.instance = this
    }
  }

  /**
   * Get source configuration
   * @example getSRCConfig() // { credentials: { apiKey: 'abc' } }
   */
  public getSRCConfig<T>(key: string): T
  public getSRCConfig<T extends Record<string, unknown>>(key?: undefined): T
  public getSRCConfig<T extends Record<string, unknown> | unknown>(
    key?: string
  ): T {
    try {
      if (key) {
        return SKILL_SRC_CONFIG[key] as T
      }

      return SKILL_SRC_CONFIG as T
    } catch (e) {
      console.error('Error while getting source configuration:', e)

      return {} as T
    }
  }

  /**
   * Apply data to the answer
   * @param answerKey The answer key
   * @param data The data to apply
   * @example setAnswerData('key', { name: 'Leon' })
   */
  public setAnswerData(
    answerKey: string | undefined,
    data: AnswerData = null
  ): string | null | undefined {
    if (answerKey) {
      try {
        // In case the answer key is a raw answer
        if (SKILL_CONFIG.answers == null || !SKILL_CONFIG.answers[answerKey]) {
          return answerKey
        }

        const answers = SKILL_CONFIG.answers[answerKey] ?? ''
        let answer: string

        if (Array.isArray(answers)) {
          answer = answers[Math.floor(Math.random() * answers.length)] ?? ''
        } else {
          answer = answers
        }

        if (data) {
          for (const key in data) {
            answer = answer.replaceAll(`%${key}%`, String(data[key]))
          }
        }

        if (SKILL_CONFIG.variables) {
          const { variables } = SKILL_CONFIG

          for (const key in variables) {
            answer = answer.replaceAll(`%${key}%`, String(variables[key]))
          }
        }

        return answer
      } catch (e) {
        console.error('Error while setting answer data:', e)

        return null
      }
    }

    return undefined
  }

  /**
   * Send an answer to the core
   * @param answerInput The answer input
   * @example answer({ key: 'greet' }) // 'Hello world'
   * @example answer({ key: 'welcome', data: { name: 'Louis' } }) // 'Welcome Louis'
   * @example answer({ key: 'confirm', core: { restart: true } }) // 'Would you like to retry?'
   */
  public async answer(answerInput: AnswerInput): Promise<void> {
    try {
      const answerObject: AnswerOutput = {
        ...INTENT_OBJECT,
        output: {
          codes:
            answerInput.widget && !answerInput.key
              ? 'widget'
              : (answerInput.key as string),
          speech: this.setAnswerData(answerInput.key, answerInput.data) ?? '',
          core: answerInput.core,
          options: this.getSRCConfig('options')
        }
      }

      if (answerInput.widget) {
        answerObject.output.widget = answerInput.widget
      }

      // "Temporize" for the data buffer output on the core
      await new Promise((r) => setTimeout(r, 100))

      process.stdout.write(JSON.stringify(answerObject))
    } catch (e) {
      console.error('Error while creating answer:', e)
    }
  }
}

export const leon = new Leon()
