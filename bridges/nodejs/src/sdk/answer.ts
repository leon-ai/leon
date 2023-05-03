import type { ActionResponse } from '@bridge/sdk/types'
import { getIntentObject } from '@bridge/utils'
import { AnswerTypes } from '@bridge/types'

/**
 * Holds methods to communicate data from the skill to the core
 */

abstract class Answer {
  /**
   * Send an answer to the core
   * @param text
   */
  protected abstract text(text: string): Promise<ActionResponse>

  /**
   * Create an answer object to send an answer to the core
   * @param type The type of the answer
   * @param text The text to send
   */
  protected async createAnswerObject(
    type: AnswerTypes,
    text: string
  ): Promise<ActionResponse> {
    try {
      const answer = {
        ...(await getIntentObject()),
        output: {
          type,
          codes: '', // TODO
          speech: text,
          core: {}, // TODO
          options: {} // TODO
        }
      }

      process.stdout.write(JSON.stringify(answer))

      return answer
    } catch (e) {
      console.error('Error creating answer object:', e)

      return null
    }
  }
}

export class IntermediateAnswer extends Answer {
  /**
   * Create an answer object with the intermediate type
   * to send an intermediate answer to the core.
   * Used to send an answer before the final answer
   * @param text The text to send
   * @example await new IntermediateAnswer().text('intermediate answer')
   */
  public async text(text: string): Promise<ActionResponse> {
    try {
      return await this.createAnswerObject(AnswerTypes.Intermediate, text)
    } catch (e) {
      console.error('Error creating intermediate answer:', e)

      return null
    }
  }
}

export class FinalAnswer extends Answer {
  /**
   * Create an answer object with the final type
   * to send a final answer to the core.
   * Used to send an answer before the end of the skill action
   * @param text The text to send
   * @example await new FinalAnswer().text('final answer')
   */
  public async text(text: string): Promise<ActionResponse> {
    try {
      return await this.createAnswerObject(AnswerTypes.Final, text)
    } catch (e) {
      console.error('Error creating final answer:', e)

      return null
    }
  }
}
