import { command } from 'execa'

import log from '@/helpers/log'
import loader from '@/helpers/loader'

/**
 * This script ensures the correct coding syntax of the whole project
 */
;(async () => {
  loader.start()
  log.info('Linting...')

  try {
    const globs = [
      '"app/src/js/*.{ts,js}"',
      // TODO: deal with it once handling new hotword
      // '"hotword/index.{ts,js}"',
      // TODO: put it back once tests have been reintroduced into skills
      // '"skills/**/*.js"',
      '"scripts/**/*.{ts,js}"',
      '"server/src/**/*.{ts,js}"'
      // TODO: put it back once tests need to be written
      /*'"test/!*.js"',
      '"test/e2e/!**!/!*.js"',
      '"test/json/!**!/!*.js"',
      '"test/unit/!**!/!*.js"'*/
    ]
    const src = globs.join(' ')

    await command(
      `prettier --write . --ignore-path .gitignore && eslint ${src} --ignore-path .gitignore && prettier --check ${src} --ignore-path .gitignore`,
      { shell: true }
    )

    log.success('Looks great')
    loader.stop()
  } catch (e) {
    log.error(`Does not look great: ${e.message}`)
    loader.stop()
    process.exit(1)
  }
})()
