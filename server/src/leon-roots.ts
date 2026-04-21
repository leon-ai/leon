import os from 'node:os'
import path from 'node:path'

/**
 * Pure Leon root paths resolved directly from the current environment.
 *
 * This module must stay lightweight and side-effect free so it can be safely
 * imported by early boot entrypoints such as Vite, Vitest, and low-level
 * helpers without pulling in `server/src/constants.ts`.
 *
 * In other words:
 * - `leon-roots.ts` owns the minimal environment-derived roots.
 * - `constants.ts` owns broader runtime constants plus derived paths that are
 *   tied to the server runtime configuration.
 */
export const DEFAULT_LEON_PROFILE = 'just-me'
const LEON_HOME_DIRNAME = '.leon'

export const CODEBASE_PATH = path.resolve(
  String(process.env['LEON_CODEBASE_PATH'] || '').trim() || process.cwd()
)

export const LEON_HOME_PATH = (() : string => {
  const configuredLeonHome = String(process.env['LEON_HOME'] || '').trim()

  return configuredLeonHome
    ? path.resolve(configuredLeonHome)
    : path.join(os.homedir(), LEON_HOME_DIRNAME)
})()

export const LEON_PROFILE_NAME =
  String(process.env['LEON_PROFILE'] || '').trim() || DEFAULT_LEON_PROFILE

export const LEON_PROFILES_PATH = path.join(LEON_HOME_PATH, 'profiles')
export const LEON_PROFILE_PATH = path.join(
  LEON_PROFILES_PATH,
  LEON_PROFILE_NAME
)
export const PROFILE_DOT_ENV_PATH = path.join(LEON_PROFILE_PATH, '.env')
