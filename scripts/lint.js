import { command } from 'execa'

import log from '@/helpers/log'
import loader from '@/helpers/loader'

/**
 * This script ensures the correct coding syntax of the whole project
 */
(async () => {
  loader.start()
  log.info('Linting...')

  try {
    const globs = [
      '"app/src/js/*.js"',
      '"hotword/index.js"',
      // TODO: put it back once tests have been reintroduced into skills
      // '"skills/**/*.js"',
      '"scripts/**/*.js"',
      '"server/src/**/*.js"',
      '"test/*.js"',
      '"test/e2e/**/*.js"',
      '"test/json/**/*.js"',
      '"test/unit/**/*.js"'
    ]

    await command(`npx eslint ${globs.join(' ')}`, { shell: true })

    log.success('Looks great')
    loader.stop()
  } catch (e) {
    log.error(`Does not look great: ${e.stdout}`)
    loader.stop()
    process.exit(1)
  }
})()
