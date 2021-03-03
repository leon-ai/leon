import { Spinner } from 'cli-spinner'

import log from '@/helpers/log'

const sentences = [
  'This process takes time, please go for a coffee (or a fruit juice)',
  'This will take a while, grab a drink and come back later',
  'Go for a walk, this action takes time',
  'That will take some time, let\'s chill and relax',
  'Leon will be ready for you in a moment'
]
const spinner = new Spinner('\x1b[95m%s\x1b[0m\r').setSpinnerString(18)
const loader = { }
let intervalId = 0

/**
 * Start spinner and log waiting sentences
 */
loader.start = () => {
  intervalId = setInterval(() => {
    if (spinner.isSpinning()) {
      log.info(sentences[Math.floor(Math.random() * sentences.length)])
    }
  }, 60000)

  return spinner.start()
}

/**
 * Stop spinner and sentences logging
 */
loader.stop = () => {
  clearInterval(intervalId)
  return spinner.stop()
}

export default loader
