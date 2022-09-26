import { Spinner } from 'cli-spinner'

import { LogHelper } from '@/helpers/log-helper'

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export class LoaderHelper {
  static readonly SENTENCES = [
    'This process takes time, please go for a coffee (or a fruit juice)',
    'This may take a while, grab a drink and come back later',
    'Go for a walk, this action takes time',
    "That may take some time, let's chill and relax",
    'Leon will be ready for you in a moment'
  ]

  private static spinner = new Spinner('\x1b[95m%s\x1b[0m\r').setSpinnerString(
    18
  )

  private static interval: NodeJS.Timer | undefined

  /**
   * Start the loader
   */
  public static start(): void {
    this.interval = setInterval(() => {
      if (this.spinner.isSpinning()) {
        const randomSentenceIndex = randomNumber(
          0,
          LoaderHelper.SENTENCES.length - 1
        )
        const randomSentence = LoaderHelper.SENTENCES[randomSentenceIndex]

        LogHelper.info(randomSentence ?? 'Loading...')
      }
    }, 60_000)

    this.spinner.start()
  }

  /**
   * Stop the loader
   */
  public static stop(): void {
    clearInterval(this.interval)

    this.spinner.stop()
  }
}
