import path from 'node:path'

import { CODEBASE_PATH } from '@/constants'
import { ensureConnectionEncryptionKey } from '@/core/connections/connection-store'

import ensureLeonHomeStructure from './setup-home'
import setupDotenv from './setup-dotenv'
import setupConfig from './setup-config'
import setupPythonBridgeEnv from './setup-python-bridge-env'
import setupMigrations from './setup-migrations'
import setupToolsSettings from './setup-tools-settings'
import setupSkills from './setup-skills/setup-skills'
import generateProfileToken from '../generate/generate-profile-token'
import createInstanceID from './create-instance-id'
import { SetupUI } from './setup-ui'

/**
 * Prepares one profile using the same ordered steps for source and prebuilt
 * installations. Source-only work runs at its dependency boundaries; prebuilt
 * releases bind their bundled packages without running package managers.
 *
 * @param {object} [options]
 * @param {boolean} [options.installDependencies]
 * @param {(name: string) => void} [options.onStep]
 * @param {() => Promise<void>} [options.prepareRuntime]
 * @param {() => Promise<void>} [options.prepareTools]
 */
export async function setupProfile({
  installDependencies = true,
  onStep = () => undefined,
  prepareRuntime = async () => undefined,
  prepareTools = async () => undefined
} = {}) {
  const run = async (name, action) => {
    onStep(name)
    await action()
  }

  await run('ensureLeonHomeStructure', ensureLeonHomeStructure)
  await run('setupDotenv', setupDotenv)
  await run('setupConfig', setupConfig)
  await prepareRuntime()
  await run('setupPythonBridgeEnv', () => setupPythonBridgeEnv({
    prebuiltPackagesPath: installDependencies
      ? undefined
      : path.join(CODEBASE_PATH, 'runtime/python-bridge/site-packages')
  }))
  await run('generateProfileToken', generateProfileToken)
  await run('generateConnectionEncryptionKey', async () => {
    await ensureConnectionEncryptionKey()
    SetupUI.success('Connection encryption key: ready')
  })
  await run('createInstanceID', createInstanceID)
  await run('setupMigrations', setupMigrations)
  await prepareTools()
  await run('setupToolsSettings', setupToolsSettings)
  await run('setupSkills', () => setupSkills({ installDependencies }))
}
