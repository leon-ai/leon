import ora from 'ora'
import { randomUUID } from 'node:crypto'

import { reportSetupProgress } from './setup-progress'

import { createSetupJokeScheduler } from './setup-jokes'

/**
 * A setup spinner whose lifecycle methods return the same status handle.
 * @typedef {object} SetupStatus
 * @property {() => SetupStatus} start
 * @property {() => SetupStatus} pause
 * @property {() => SetupStatus} stop
 * @property {(text?: string) => SetupStatus} succeed
 * @property {(text?: string) => SetupStatus} fail
 * @property {(text?: string) => SetupStatus} warn
 * @property {boolean} isSpinning
 * @property {string} text
 */

/**
 * Create a setup spinner that plays well with prompts and download output.
 * @param {string} text
 * @returns {SetupStatus}
 */
export function createSetupStatus(text) {
  const id = randomUUID()
  const structured = process.env.LEON_SETUP_PROGRESS === 'json'
  const emit = (phase, label = spinner.text) => {
    reportSetupProgress({ id, phase, label })
  }
  const spinner = ora({
    isSilent: structured,
    spinner: 'dots2',
    color: 'cyan',
    text,
    stream: process.stdout,
    discardStdin: false
  })
  const jokeScheduler = createSetupJokeScheduler()
  const status = {
    start() {
      if (!structured) {
        jokeScheduler.start()
      }
      emit('running')
      spinner.start()

      return status
    },
    pause() {
      spinner.stop()

      return status
    },
    stop() {
      jokeScheduler.finish()
      emit('complete')
      spinner.stop()

      return status
    },
    succeed(successText) {
      jokeScheduler.finish()
      emit('complete', successText)
      spinner.succeed(successText)

      return status
    },
    fail(failureText) {
      jokeScheduler.finish()
      emit('failed', failureText)
      spinner.fail(failureText)

      return status
    },
    warn(warningText) {
      jokeScheduler.finish()
      emit('message', warningText)
      spinner.warn(warningText)

      return status
    },
    get isSpinning() {
      return spinner.isSpinning
    },
    get text() {
      return spinner.text
    },
    set text(nextText) {
      spinner.text = nextText
      emit('running', nextText)
    }
  }

  return status
}
