import fs from 'node:fs'
import path from 'node:path'

import type { SkillLocaleConfigSchema } from '@/schemas/skill-schemas'
import type { IntentObject, NLPAction } from '@sdk/types'
import {
  CODEBASE_PATH,
  LEON_HOME_PATH,
  LEON_PROFILE_PATH
} from '@@/server/src/leon-roots'

const args = process.argv.slice(2)
const runtimeIndex = args.indexOf('--runtime')
const runtime =
  runtimeIndex >= 0 && args[runtimeIndex + 1] ? args[runtimeIndex + 1] : 'skill'
const filteredArgs = args.filter((_, index) => {
  if (index === runtimeIndex || index === runtimeIndex + 1) {
    return false
  }
  return true
})
const intentPathCandidate = filteredArgs.find((arg) => !arg.startsWith('--'))
const INTENT_OBJ_FILE_PATH =
  runtime === 'skill' ? intentPathCandidate : undefined

export const LEON_VERSION = process.env['npm_package_version']

export const RUNTIME = runtime

export {
  CODEBASE_PATH,
  LEON_HOME_PATH,
  LEON_PROFILE_PATH
}

export const LEON_TOOLKITS_PATH = path.join(LEON_HOME_PATH, 'toolkits')
export const CODEBASE_CONTEXT_PATH = path.join(CODEBASE_PATH, 'core', 'context')
export const PROFILE_CONTEXT_PATH = path.join(LEON_PROFILE_PATH, 'context')
export const PROFILE_MEMORY_PATH = path.join(LEON_PROFILE_PATH, 'memory')
export const PROFILE_MEMORY_DB_PATH = path.join(
  PROFILE_MEMORY_PATH,
  'index.sqlite'
)
export const PROFILE_SKILLS_PATH = path.join(LEON_PROFILE_PATH, 'skills')
export const PROFILE_NATIVE_SKILLS_PATH = path.join(
  PROFILE_SKILLS_PATH,
  'native'
)
export const PROFILE_AGENT_SKILLS_PATH = path.join(
  PROFILE_SKILLS_PATH,
  'agent'
)
export const PROFILE_TOOLS_PATH = path.join(LEON_PROFILE_PATH, 'tools')

const BIN_PATH = path.join(LEON_HOME_PATH, 'bin')
const BRIDGES_PATH = path.join(CODEBASE_PATH, 'bridges')
const NODEJS_BRIDGE_ROOT_PATH = path.join(BRIDGES_PATH, 'nodejs')
const NODEJS_BRIDGE_SRC_PATH = path.join(NODEJS_BRIDGE_ROOT_PATH, 'src')
const NODEJS_BRIDGE_VERSION_FILE_PATH = path.join(
  NODEJS_BRIDGE_SRC_PATH,
  'version.ts'
)

export const TOOLS_PATH = path.join(CODEBASE_PATH, 'tools')
export const PROFILE_DISABLED_PATH = path.join(LEON_PROFILE_PATH, 'disabled.json')

export const [, NODEJS_BRIDGE_VERSION] = fs
  .readFileSync(NODEJS_BRIDGE_VERSION_FILE_PATH, 'utf8')
  .split('\'')

let parsedIntentObject: IntentObject | null = null
if (INTENT_OBJ_FILE_PATH) {
  if (!fs.existsSync(INTENT_OBJ_FILE_PATH)) {
    throw new Error(`Intent file not found: ${INTENT_OBJ_FILE_PATH}`)
  }
  parsedIntentObject = JSON.parse(
    fs.readFileSync(INTENT_OBJ_FILE_PATH, 'utf8')
  ) as IntentObject
}

export const INTENT_OBJECT: IntentObject = parsedIntentObject
  ? parsedIntentObject
  : ({} as IntentObject)

export const NVIDIA_LIBS_PATH = path.join(BIN_PATH, 'nvidia')

export const PYTORCH_PATH = path.join(BIN_PATH, 'pytorch')
export const PYTORCH_TORCH_PATH = path.join(PYTORCH_PATH, 'torch')

export const SKILLS_PATH = path.join(CODEBASE_PATH, 'skills')
export const NATIVE_SKILLS_PATH = path.join(SKILLS_PATH, 'native')
export const AGENT_SKILLS_PATH = path.join(SKILLS_PATH, 'agent')
export const SKILL_PATH =
  runtime === 'skill' && parsedIntentObject
    ? path.dirname(parsedIntentObject.skill_config_path)
    : ''
const SKILL_LOCALE_CONFIG_CONTENT =
  runtime === 'skill' && INTENT_OBJ_FILE_PATH && parsedIntentObject
    ? ((): SkillLocaleConfigSchema => {
        const skillLocalePath = path.join(
          SKILL_PATH,
          'locales',
          parsedIntentObject.extra_context.lang + '.json'
        )
        return JSON.parse(
          fs.existsSync(skillLocalePath)
            ? fs.readFileSync(skillLocalePath, 'utf8')
            : `{"variables": {}, "common_answers": {}, "widget_contents": {}, "actions": {"${parsedIntentObject.action_name}": {}}}`
        ) as SkillLocaleConfigSchema
      })()
    : {
        variables: {},
        common_answers: {},
        widget_contents: {},
        actions: {}
      } satisfies SkillLocaleConfigSchema

export const SKILL_LOCALE_CONFIG = {
  variables: SKILL_LOCALE_CONFIG_CONTENT.variables,
  common_answers: SKILL_LOCALE_CONFIG_CONTENT.common_answers,
  widget_contents: SKILL_LOCALE_CONFIG_CONTENT.widget_contents,
  ...((runtime === 'skill' && parsedIntentObject
    ? SKILL_LOCALE_CONFIG_CONTENT.actions[
        parsedIntentObject.action_name as NLPAction
      ]
    : {}) || {})
} as SkillLocaleConfigSchema & SkillLocaleConfigSchema['actions'][NLPAction]
