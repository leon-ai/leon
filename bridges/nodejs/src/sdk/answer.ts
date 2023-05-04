import type { AnswerObject } from '@bridge/types'

/**
 * Holds methods to communicate data from the skill to the core
 */

interface AnswerOptions {
  text: string
}

export abstract class Answer implements AnswerOptions {
  public abstract text: string

  /**
   * Create an answer object to send an answer to the core
   * @param type The type of the answer
   * @param text The text to send
   */
  public async createAnswerOutput(): Promise<AnswerObject['output']> {
    return {
      codes: '', // TODO
      speech: this.text,
      core: {}, // TODO
      options: {} // TODO
    }
  }
}

export class TextAnswer extends Answer {
  public override text: string

  /**
   * Create an answer object to send an answer containing text to the core
   * @param text The text to send
   * @example new TextAnswer('Hello world')
   */
  public constructor(text: string) {
    super()
    this.text = text
  }
}

export class HTMLAnswer extends Answer {
  public override html: string

  /**
   * Create an answer object to send an answer containing HTML to the core
   * @param html The HTML to send
   * @example new HTMLAnswer('<ul><li>Apples</li><li>Strawberries</li></ul>')
   */
  public constructor(html: string) {
    super()
    this.html = html
  }
}
