import fs from 'node:fs'

import {
  CACHE_PATH,
  LEON_HOME_PATH,
  LEON_PROFILES_PATH,
  LEON_PROFILE_PATH,
  LEON_TOOLKITS_PATH,
  MODELS_PATH,
  PROFILE_CONTEXT_PATH,
  PROFILE_AGENT_SKILLS_PATH,
  PROFILE_LOGS_PATH,
  PROFILE_MEMORY_PATH,
  PROFILE_NATIVE_SKILLS_PATH,
  PROFILE_SKILLS_PATH,
  PROFILE_TOOLS_PATH,
  TMP_PATH
} from '@/constants'

import { createSetupStatus } from './setup-status'

/**
 * Create Leon home directories that setup and runtime expect to exist.
 */
export default async function ensureLeonHomeStructure() {
  const status = createSetupStatus('Preparing Leon home...').start()

  await Promise.all([
    fs.promises.mkdir(LEON_HOME_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_PROFILES_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_PROFILE_PATH, { recursive: true }),
    fs.promises.mkdir(CACHE_PATH, { recursive: true }),
    fs.promises.mkdir(LEON_TOOLKITS_PATH, { recursive: true }),
    fs.promises.mkdir(MODELS_PATH, { recursive: true }),
    fs.promises.mkdir(TMP_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_MEMORY_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_LOGS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_NATIVE_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_AGENT_SKILLS_PATH, { recursive: true }),
    fs.promises.mkdir(PROFILE_TOOLS_PATH, { recursive: true })
  ])

  status.succeed('Leon home: ready')
}
