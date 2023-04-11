import { LogHelper } from '@/helpers/log-helper'

import generateJsonSchemas from './generate-json-schemas'

/**
 * Execute the generating JSON schemas script
 */
;(async () => {
  try {
    await generateJsonSchemas()
  } catch (error) {
    LogHelper.error(`Failed to generate the json schemas: ${error}`)
  }
})()
