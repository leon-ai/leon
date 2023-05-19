import fs from 'node:fs'
import path from 'node:path'

import { SKILLS_PATH as SKILLS_ROOT_PATH } from '@/constants'
import type { SkillConfigSchema } from '@server/schemas/skill-schemas'

import type { IntentObject } from '@sdk/types'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

export const INTENT_OBJECT: IntentObject = JSON.parse(
  fs.readFileSync(INTENT_OBJ_FILE_PATH as string, 'utf8')
)
export const SKILL_PATH = path.join(
  SKILLS_ROOT_PATH,
  INTENT_OBJECT.domain,
  INTENT_OBJECT.skill
)
export const SKILLS_PATH = SKILLS_ROOT_PATH
export const SKILL_CONFIG: SkillConfigSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      SKILL_PATH,
      'config',
      INTENT_OBJECT.extra_context_data.lang + '.json'
    ),
    'utf8'
  )
)
export const SKILL_SRC_CONFIG: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(SKILL_PATH, 'src', 'config.json'), 'utf8')
).configurations
