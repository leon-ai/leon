import { NODEJS_BRIDGE_ROOT_PATH } from '@/constants'

import { syncNodejsSourceDependencies } from './sync-source-dependencies'
import { createSetupStatus } from './setup-status'

/**
 * Keep bridge dependencies local and repair incomplete installations on retry.
 */
export default async function setupNodejsBridgeEnv() {
  const status = createSetupStatus('Setting up Node.js bridge...').start()

  await syncNodejsSourceDependencies(NODEJS_BRIDGE_ROOT_PATH)

  status.succeed('Node.js bridge: ready')
}
