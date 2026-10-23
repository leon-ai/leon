import fs from 'node:fs'
import path from 'node:path'

import { execa } from 'execa'

import { createSetupStatus } from './setup-status'

const GIT_PATH = path.join(process.cwd(), '.git')
const HUSKY_BIN_PATH = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'husky.cmd' : 'husky'
)

/**
 * Install git hooks through Husky when Leon is inside a git checkout.
 */
export default async function setupGitHooks() {
  if (process.env.GITHUB_ACTIONS === 'true' || !fs.existsSync(GIT_PATH)) {
    return
  }

  const status = createSetupStatus('Setting up git hooks...').start()

  try {
    await execa(HUSKY_BIN_PATH, [], {
      stdio: 'ignore'
    })

    status.succeed('Git hooks: ready')
  } catch (error) {
    status.fail('Failed to set up git hooks')
    throw error
  }
}
