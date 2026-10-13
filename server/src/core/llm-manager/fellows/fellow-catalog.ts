import path from 'node:path'
import os from 'node:os'
import execa from 'execa'

import catalog from './fellows.json' with { type: 'json' }

export interface FellowDefinition {
  id: string
  label: string
  directory: string
  directoryEnv: string
  root?: string
  files: string[][]
  configFiles?: string[][]
  accountStores?: { shared: string, agent: string, legacy: string }
  upstream: string
  sources: string[]
  documentation?: string
}

export interface FellowEnvironment {
  home: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}

const CLAUDE_AUTH_OVERRIDES = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'
]
const CLI_STATUS_TIMEOUT_MS = 5_000

export const FELLOWS: readonly FellowDefinition[] = catalog

/**
 * Resolve the installing user's directories, independently of Leon profiles.
 */
export function getFellowEnvironment(): FellowEnvironment {
  return { home: os.homedir(), platform: process.platform, env: process.env }
}

/**
 * Respect fellow-specific overrides before applying documented home/XDG paths.
 */
export function getFellowDirectory(
  fellow: FellowDefinition,
  environment: FellowEnvironment,
  config = false
): string {
  const { home, env, platform } = environment
  const paths = platform === 'win32' ? path.win32 : path
  const override = fellow.directoryEnv && env[fellow.directoryEnv]

  if (override) {
    return paths.resolve(override)
  }

  if (fellow.root === 'data') {
    // OpenCode uses XDG directories on all platforms, including Windows.
    const root = config
      ? env['XDG_CONFIG_HOME'] || paths.join(home, '.config')
      : env['XDG_DATA_HOME'] || paths.join(home, '.local', 'share')

    return paths.join(root, fellow.directory)
  }

  return paths.join(home, ...fellow.directory.split('/'))
}

/**
 * Let Claude Code use the selected login, without inherited API/cloud overrides.
 * Pass extendEnv: false to execa so deleted variables stay removed.
 */
export function getClaudeSubscriptionEnvironment(
  directory: string,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...inherited, CLAUDE_CONFIG_DIR: directory } as NodeJS.ProcessEnv
  for (const name of CLAUDE_AUTH_OVERRIDES) {
    delete env[name]
  }
  return env
}

/**
 * Verify the selected Claude Code login, including keyring-backed credentials.
 */
export async function isClaudeSubscriptionAvailable(
  directory: string,
  inherited: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const status = await execa('claude', ['auth', 'status', '--json'], {
    env: getClaudeSubscriptionEnvironment(directory, inherited),
    extendEnv: false,
    timeout: CLI_STATUS_TIMEOUT_MS,
    reject: false
  }).catch(() => null)

  if (status?.exitCode !== 0) {
    return false
  }

  try {
    const auth = JSON.parse(status.stdout) as Record<string, unknown>
    return auth['loggedIn'] === true && auth['authMethod'] === 'claude.ai'
  } catch {
    // Files and older CLI versions cannot confirm a usable subscription login.
    return false
  }
}
