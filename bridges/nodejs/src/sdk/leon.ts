import fs from 'node:fs'

import type { AnswerObject, IntentObject } from '@bridge/types'
import type { Answer } from '@sdk/answer'

class Leon {
  private static instance: Leon

  constructor() {
    if (!Leon.instance) {
      Leon.instance = this
    }
  }

  /**
   * Send an answer to the core
   * @param answer
   */
  public async answer(answer: Answer): Promise<void> {
    try {
      const answerObject: AnswerObject = {
        ...(await this.getIntentObject()),
        output: await answer.createAnswerOutput()
      }

      process.stdout.write(JSON.stringify(answerObject))
    } catch (error) {
      console.error('Error while creating answer:', error)
    }
  }

  /**
   * Get the intent object from the temporary intent file
   * @example await getIntentObject() // { ... }
   */
  private async getIntentObject(): Promise<IntentObject> {
    const {
      argv: [, , INTENT_OBJ_FILE_PATH]
    } = process

    return JSON.parse(
      await fs.promises.readFile(INTENT_OBJ_FILE_PATH as string, 'utf8')
    )
  }
}

export const leon = new Leon()
