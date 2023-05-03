import fs from 'node:fs'

import type { IntentObject } from '@bridge/types'

const {
  argv: [, , INTENT_OBJ_FILE_PATH]
} = process

/**
 * Get the intent object from the temporary intent file
 * @example await getIntentObject() // { ... }
 */
export async function getIntentObject(): Promise<IntentObject> {
  return JSON.parse(
    await fs.promises.readFile(INTENT_OBJ_FILE_PATH as string, 'utf8')
  )
}
