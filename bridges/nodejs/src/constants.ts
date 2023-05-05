import fs from 'node:fs'
import path from 'node:path'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

export const INTENT_OBJECT = JSON.parse(
  fs.readFileSync(INTENT_OBJ_FILE_PATH as string, 'utf8')
)
export const SKILL_CONFIG = JSON.parse(
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
export const SKILL_SRC_CONFIG = JSON.parse(
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
