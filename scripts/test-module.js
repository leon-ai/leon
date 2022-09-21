import { command } from 'execa'

import { LOG } from '@/helpers/log'
import { LOADER } from '@/helpers/loader'

/**
 * Specific module testing script
 *
 * npm run test:module videodownloader:youtube
 */
;(async () => {
  const { argv } = process
  const s = argv[2].toLowerCase()
  const arr = s.split(':')
  const [pkg, module] = arr

  try {
    LOADER.start()
    await command('npm run train en', { shell: true })
    const cmd = await command(
      `cross-env PIPENV_PIPFILE=bridges/python/Pipfile LEON_NODE_ENV=testing jest --silent --config=./test/e2e/modules/e2e.modules.jest.json packages/${pkg}/test/${module}.spec.js && npm run train`,
      { shell: true }
    )

    LOG.default(cmd.stdout)
    LOG.default(cmd.stderr)
    LOADER.stop()
  } catch (e) {
    LOG.default(e.message)
    LOADER.stop()
  }
})()
