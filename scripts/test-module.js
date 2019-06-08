import { shell } from 'execa'

import log from '@/helpers/log'
import loader from '@/helpers/loader'

/**
 * Specific module testing script
 *
 * npm run test:module videodownloader:youtube
 */
(async () => {
  const { argv } = process
  const s = argv[2].toLowerCase()
  const arr = s.split(':')
  const [pkg, module] = arr

  try {
    loader.start()
    await shell('npm run train expressions:en')
    const cmd = await shell(`cross-env PIPENV_PIPFILE=bridges/python/Pipfile LEON_NODE_ENV=testing jest --silent --config=./test/e2e/modules/e2e.modules.jest.json packages/${pkg}/test/${module}.spec.js && npm run train expressions`)

    log.default(cmd.stdout)
    log.default(cmd.stderr)
    loader.stop()
  } catch (e) {
    log.default(e.message)
    loader.stop()
  }
})()
