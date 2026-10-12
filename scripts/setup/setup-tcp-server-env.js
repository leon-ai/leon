import { PYTHON_TCP_SERVER_SRC_PATH } from '@/constants'

import { setupPythonProjectEnv } from './setup-python-project-env'

/**
 * Sync the Python TCP server runtime environment from its `pyproject.toml`.
 */
export default async function setupTCPServerEnv() {
  await setupPythonProjectEnv({
    name: 'Python TCP server',
    projectPath: PYTHON_TCP_SERVER_SRC_PATH,
    stampFileName: '.last-tcp-server-deps-sync'
  })
}
