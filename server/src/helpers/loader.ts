import { Spinner } from 'cli-spinner'

import { log } from '@/helpers/log'

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Loader Singleton Class.
 */
export class Loader {
  private static instance: Loader
  static readonly SENTENCES = [
    'This process takes time, please go for a coffee (or a fruit juice)',
    'This may take a while, grab a drink and come back later',
    'Go for a walk, this action takes time',
    "That may take some time, let's chill and relax",
    'Leon will be ready for you in a moment'
  ] as const

  private spinner = new Spinner('\x1b[95m%s\x1b[0m\r').setSpinnerString(18)

  private interval: NodeJS.Timer | undefined = undefined

  private constructor() {
    // Singleton
  }

  public static getInstance(): Loader {
    if (Loader.instance == null) {
      Loader.instance = new Loader()
    }
    return Loader.instance
  }

  public start(): void {
    this.interval = setInterval(() => {
      if (this.spinner.isSpinning()) {
        const randomSentenceIndex = randomNumber(0, Loader.SENTENCES.length - 1)
        const randomSentence = Loader.SENTENCES[randomSentenceIndex]
        log.info(randomSentence ?? 'Loading...')
      }
    }, 60_000)
    this.spinner.start()
  }

  public stop(): void {
    clearInterval(this.interval)
    this.spinner.stop()
  }
}

export const loader = Loader.getInstance()
