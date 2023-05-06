import fs from 'node:fs'
import path from 'node:path'

import type { SkillConfigSchema } from '@/schemas/skill-schemas'

import type { IntentObject } from '@sdk/types'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

export const INTENT_OBJECT: IntentObject = JSON.parse(
  fs.readFileSync(INTENT_OBJ_FILE_PATH as string, 'utf8')
)
export const SKILL_CONFIG: SkillConfigSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'skills',
      INTENT_OBJECT.domain,
      INTENT_OBJECT.skill,
      'config',
      INTENT_OBJECT.lang + '.json'
    ),
    'utf8'
  )
)
export const SKILL_SRC_CONFIG: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'skills',
      INTENT_OBJECT.domain,
      INTENT_OBJECT.skill,
      'src',
      'config.json'
    ),
    'utf8'
  )
).configurations
