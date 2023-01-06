import fs from 'node:fs'
import path from 'node:path'

import { LogHelper } from '@/helpers/log-helper'
import {
  domainSchemaObject,
  skillSchemaObject,
  skillConfigSchemaObject
} from '@/schemas/skill-schemas'
import {
  globalEntitySchemaObject,
  globalResolverSchemaObject,
  globalAnswersSchemaObject
} from '@/schemas/global-data-schemas'
import {
  amazonVoiceConfiguration,
  googleCloudVoiceConfiguration,
  watsonVoiceConfiguration
} from '@/schemas/voice-config-schemas'

/**
 * Generate JSON schemas
 * @param {string} categoryName 
 * @param {Map<string, Object>} schemas 
 */
export const generateSchemas = async (categoryName, schemas) => {
  const categorySchemasPath = path.join(process.cwd(), 'schemas', categoryName)
  await fs.promises.mkdir(categorySchemasPath, { recursive: true })
  for (const [schemaName, schemaObject] of schemas.entries()) {
    const schemaPath = path.join(categorySchemasPath, `${schemaName}.json`)
    await fs.promises.writeFile(
      schemaPath,
      JSON.stringify(
        {
          $schema: 'https://json-schema.org/draft-07/schema',
          ...schemaObject
        },
        null,
        2
      )
    )
  }
}

export default async () => {
  LogHelper.info('Generating the JSON schemas...')
  await Promise.all([
    generateSchemas(
      'global-data',
      new Map([
        ['global-entity', globalEntitySchemaObject],
        ['global-resolver', globalResolverSchemaObject],
        ['global-answers', globalAnswersSchemaObject]
      ])
    ),
    generateSchemas(
      'skill-schemas',
      new Map([
        ['domain', domainSchemaObject],
        ['skill', skillSchemaObject],
        ['skill-config', skillConfigSchemaObject]
      ])
    ),
    generateSchemas(
      'voice-config-schemas',
      new Map([
        ['amazon', amazonVoiceConfiguration],
        [
          'google-cloud',
          googleCloudVoiceConfiguration
        ],
        ['watson-stt', watsonVoiceConfiguration],
        ['watson-tts', watsonVoiceConfiguration]
      ])
    )
  ])
  LogHelper.success('JSON schemas generated')
}
