import path from 'node:path'

import { LEON_PROFILES_PATH } from '@/leon-roots'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

export const PROFILE_TOKEN_SEPARATOR = ':'

export interface ProfilePaths {
  name: string
  root: string
  config: string
  dotEnv: string
  context: string
  memory: string
  logs: string
  skills: string
  nativeSkills: string
  agentSkills: string
  tools: string
  sessions: string
}

/** Validate a profile name before using it as a filesystem segment. */
export function isValidProfileName(profileName: string): boolean {
  const normalizedProfileName = profileName.trim()

  return Boolean(
    normalizedProfileName &&
      normalizedProfileName !== '.' &&
      normalizedProfileName !== '..' &&
      !normalizedProfileName.includes(PROFILE_TOKEN_SEPARATOR) &&
      path.posix.basename(normalizedProfileName) === normalizedProfileName &&
      path.win32.basename(normalizedProfileName) === normalizedProfileName
  )
}

/** Resolve every profile-owned path from an explicit or request-scoped profile. */
export function getProfilePaths(
  profileName = getActiveProfileName()
): ProfilePaths {
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  const name = profileName.trim()
  const root = path.join(LEON_PROFILES_PATH, name)
  const skills = path.join(root, 'skills')

  return {
    name,
    root,
    config: path.join(root, 'config.yml'),
    dotEnv: path.join(root, '.env'),
    context: path.join(root, 'context'),
    memory: path.join(root, 'memory'),
    logs: path.join(root, 'logs'),
    skills,
    nativeSkills: path.join(skills, 'native'),
    agentSkills: path.join(skills, 'agent'),
    tools: path.join(root, 'tools'),
    sessions: path.join(root, 'sessions')
  }
}
