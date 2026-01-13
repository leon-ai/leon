import fs from 'node:fs'
import path from 'node:path'

import type { SkillLocaleConfigSchema } from '@/schemas/skill-schemas'

import { IntentObject, NLPAction } from '@sdk/types'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

export const LEON_VERSION = process.env['npm_package_version']

const BIN_PATH = path.join(process.cwd(), 'bin')
const BRIDGES_PATH = path.join(process.cwd(), 'bridges')
const NODEJS_BRIDGE_ROOT_PATH = path.join(BRIDGES_PATH, 'nodejs')
const NODEJS_BRIDGE_SRC_PATH = path.join(NODEJS_BRIDGE_ROOT_PATH, 'src')
const NODEJS_BRIDGE_VERSION_FILE_PATH = path.join(
  NODEJS_BRIDGE_SRC_PATH,
  'version.ts'
)

export const TOOLKITS_PATH = path.join(BRIDGES_PATH, 'toolkits')

export const [, NODEJS_BRIDGE_VERSION] = fs
  .readFileSync(NODEJS_BRIDGE_VERSION_FILE_PATH, 'utf8')
  .split("'")

export const INTENT_OBJECT: IntentObject = JSON.parse(
  fs.readFileSync(INTENT_OBJ_FILE_PATH as string, 'utf8')
)

export const CUDA_RUNTIME_PATH = path.join(BIN_PATH, 'cuda')

export const SKILLS_PATH = path.join(process.cwd(), 'skills')
export const SKILL_PATH = path.join(SKILLS_PATH, INTENT_OBJECT.skill_name)
const SKILL_LOCALE_PATH = path.join(
  SKILL_PATH,
  'locales',
  INTENT_OBJECT.extra_context.lang + '.json'
)
const SKILL_LOCALE_CONFIG_CONTENT = JSON.parse(
  fs.existsSync(SKILL_LOCALE_PATH)
    ? fs.readFileSync(SKILL_LOCALE_PATH, 'utf8')
    : `{"variables": {}, "common_answers": {}, "widget_contents": {}, "actions": {"${INTENT_OBJECT.action_name}": {}}}`
)

export const SKILL_LOCALE_CONFIG: SkillLocaleConfigSchema &
  SkillLocaleConfigSchema['actions'][NLPAction] = {
  variables: SKILL_LOCALE_CONFIG_CONTENT.variables,
  common_answers: SKILL_LOCALE_CONFIG_CONTENT.common_answers,
  widget_contents: SKILL_LOCALE_CONFIG_CONTENT.widget_contents,
  ...SKILL_LOCALE_CONFIG_CONTENT.actions[INTENT_OBJECT.action_name]
}
