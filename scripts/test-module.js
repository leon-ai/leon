import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

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
    LoaderHelper.start()
    await command('npm run train en', { shell: true })
    const cmd = await command(
      `cross-env PIPENV_PIPFILE=bridges/python/Pipfile LEON_NODE_ENV=testing jest --silent --config=./test/e2e/modules/e2e.modules.jest.json packages/${pkg}/test/${module}.spec.js && npm run train`,
      { shell: true }
    )

    LogHelper.default(cmd.stdout)
    LogHelper.default(cmd.stderr)
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.default(e.message)
    LoaderHelper.stop()
  }
})()
