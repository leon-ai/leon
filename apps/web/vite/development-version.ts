import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const INTEGRATION_BRANCH = 'develop'
const SHORT_COMMIT_LENGTH = 8

/**
 * Identifies builds from working branches using the checkout's commit.
 * Detached builds and source archives use the canonical release label.
 */
export function readDevelopmentVersionSuffix(root: string): string {
  if (!existsSync(path.join(root, '.git'))) {
    return ''
  }

  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true
  }

  try {
    const branch = execFileSync('git', ['branch', '--show-current'], options).trim()
    if (!branch || branch === INTEGRATION_BRANCH) {
      return ''
    }

    const commit = execFileSync(
      'git', ['rev-parse', `--short=${SHORT_COMMIT_LENGTH}`, 'HEAD'], options
    ).trim()

    return `+dev.${commit}`
  } catch {
    return ''
  }
}
