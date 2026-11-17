import { PYTHON_BRIDGE_SRC_PATH } from '@/constants'

import { setupPythonProjectEnv } from './setup-python-project-env'

/**
 * Sync the Python bridge runtime environment from its `pyproject.toml`.
 *
 * @param {{ prebuiltPackagesPath?: string }} [options]
 */
export default async function setupPythonBridgeEnv({ prebuiltPackagesPath } = {}) {
  await setupPythonProjectEnv({
    name: 'Python bridge',
    projectPath: PYTHON_BRIDGE_SRC_PATH,
    stampFileName: '.last-python-bridge-deps-sync',
    prebuiltPackagesPath
  })
}
