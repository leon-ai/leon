import fs from 'node:fs'
import path from 'node:path'

import { AggregateAjvError } from '@segment/ajv-human-errors'

import { ajv } from '@/ajv'
import { PROFILE_CONFIG_PATH } from '@/leon-roots'
import { configSchemaObject } from '@/schemas/core-schemas'
import { SystemHelper } from '@/helpers/system-helper'

interface ObjectUnknown {
  [key: string]: unknown
}

interface SchemaValidationOptions {
  requireSchemaKey?: boolean
}

let LogHelper: typeof import('@/helpers/log-helper').LogHelper | null = null

function logError(value: string): void {
  if (LogHelper) {
    LogHelper.error(value)
    return
  }

  console.error(`🚨 ${value}`)
}

const validateSchema = (
  schemaName: string,
  schema: ObjectUnknown,
  contentToValidate: ObjectUnknown,
  customErrorMessage: string,
  options: SchemaValidationOptions = {}
): void => {
  const schemaFile = `${schemaName}.json`
  const shouldRequireSchemaKey = options.requireSchemaKey ?? true
  const validate = ajv.compile(schema)
  const isValidSchemaKey =
    !shouldRequireSchemaKey ||
    (
      typeof contentToValidate['$schema'] === 'string' &&
      contentToValidate['$schema'].endsWith(schemaFile)
    )
  const isValid = validate(contentToValidate) && isValidSchemaKey

  if (isValid) {
    return
  }

  logError(customErrorMessage)
  if (!isValidSchemaKey) {
    logError(
      `The schema key "$schema" is not valid. Expected "${schemaName}", but got "${contentToValidate['$schema']}".`
    )
  }

  const errors = new AggregateAjvError(validate.errors ?? [])
  for (const error of errors) {
    logError(error.message)
  }
  process.exit(1)
}

async function validateProfileConfigSchema(): Promise<void> {
  try {
    const { CONFIG_MANAGER } = await import('@/config')

    validateSchema(
      'core-schemas/config',
      configSchemaObject as ObjectUnknown,
      CONFIG_MANAGER.getConfig() as unknown as ObjectUnknown,
      `The profile configuration schema "${PROFILE_CONFIG_PATH}" is not valid:`,
      {
        requireSchemaKey: false
      }
    )
  } catch (error) {
    logError(
      `The profile configuration "${PROFILE_CONFIG_PATH}" could not be loaded: ${String(error)}`
    )
    process.exit(1)
  }
}

/**
 * Pre-checking
 *
 * - Ensure the profile configuration is valid
 * - Ensure the system requirements are met
 * - Ensure JSON files are correctly formatted
 */
;(async (): Promise<void> => {
  await validateProfileConfigSchema()

  ;({ LogHelper } = await import('@/helpers/log-helper'))

  const { LangHelper } = await import('@/helpers/lang-helper')
  const { SkillDomainHelper } = await import('@/helpers/skill-domain-helper')
  const {
    MINIMUM_REQUIRED_RAM,
    VOICE_CONFIG_PATH,
    GLOBAL_DATA_PATH
  } = await import('@/constants')
  const {
    amazonVoiceConfiguration,
    googleCloudVoiceConfiguration,
    watsonVoiceConfiguration
  } = await import('@/schemas/voice-config-schemas')
  const {
    globalAnswersSchemaObject
  } = await import('@/schemas/global-data-schemas')
  const {
    skillSchemaObject,
    skillLocaleConfigObject
  } = await import('@/schemas/skill-schemas')

  const voiceConfigSchemas: Record<string, ObjectUnknown> = {
    amazon: amazonVoiceConfiguration as ObjectUnknown,
    'google-cloud': googleCloudVoiceConfiguration as ObjectUnknown,
    'watson-stt': watsonVoiceConfiguration as ObjectUnknown,
    'watson-tts': watsonVoiceConfiguration as ObjectUnknown
  }

  LogHelper.title('Pre-checking')
  LogHelper.info('Checking profile configuration schema...')
  LogHelper.success('Profile configuration schema checked')

  /**
   * System requirements checking
   */
  LogHelper.info('Checking system requirements...')

  const totalRAMInGB = Math.round(SystemHelper.getTotalRAM())
  const freeRAMInGB = Math.round(SystemHelper.getFreeRAM())

  if (freeRAMInGB < MINIMUM_REQUIRED_RAM) {
    LogHelper.warning(
      `Free RAM: ${freeRAMInGB} GB | Total RAM: ${totalRAMInGB} GB. Leon needs at least ${MINIMUM_REQUIRED_RAM} GB of RAM. It may not work as expected.`
    )
  } else {
    LogHelper.success(
      `Minimum required RAM: ${MINIMUM_REQUIRED_RAM} GB | Free RAM: ${freeRAMInGB} GB | Total RAM: ${totalRAMInGB} GB`
    )
  }

  /**
   * New updates checking
   */
  LogHelper.info('Checking for new updates...')

  /**
   * Voice configuration checking
   */
  LogHelper.info('Checking voice configuration schemas...')

  const voiceConfigFiles = (
    await fs.promises.readdir(VOICE_CONFIG_PATH)
  ).filter((file) => file.endsWith('.json'))

  for (const file of voiceConfigFiles) {
    const voiceConfigPath = path.join(VOICE_CONFIG_PATH, file)
    const config = JSON.parse(
      await fs.promises.readFile(voiceConfigPath, 'utf8')
    ) as ObjectUnknown
    const [configName = ''] = file.split('.')
    const voiceSchema = voiceConfigSchemas[configName]

    if (!voiceSchema) {
      LogHelper.error(`The voice configuration schema "${configName}" is unknown.`)
      process.exit(1)
    }

    validateSchema(
      `voice-config-schemas/${configName}`,
      voiceSchema,
      config,
      `The voice configuration schema "${voiceConfigPath}" is not valid:`
    )
  }
  LogHelper.success('Voice configuration schemas checked')

  /**
   * Global data checking
   */
  LogHelper.info('Checking global data schemas...')

  const supportedLangs = LangHelper.getShortCodes()
  for (const lang of supportedLangs) {
    /**
     * Global answers checking
     */
    const globalAnswersPath = path.join(GLOBAL_DATA_PATH, lang, 'answers.json')
    const answers = JSON.parse(
      await fs.promises.readFile(globalAnswersPath, 'utf8')
    ) as ObjectUnknown

    validateSchema(
      'global-data/global-answers',
      globalAnswersSchemaObject as ObjectUnknown,
      answers,
      `The global answers schema "${globalAnswersPath}" is not valid:`
    )
  }
  LogHelper.success('Global data schemas checked')

  /**
   * Skills data checking
   */
  LogHelper.info('Checking skills data schemas...')

  const skillNames = await SkillDomainHelper.listSkillFolders()

  for (const skillName of skillNames) {
    const skillPath = SkillDomainHelper.resolveSkillPath(skillName)

    if (!skillPath) {
      continue
    }

    const pathToSkill = path.join(skillPath, 'skill.json')
    const skillObject = JSON.parse(
      await fs.promises.readFile(pathToSkill, 'utf8')
    ) as ObjectUnknown

    validateSchema(
      'skill-schemas/skill',
      skillSchemaObject as ObjectUnknown,
      skillObject,
      `The skill schema "${pathToSkill}" is not valid:`
    )

    const localesPath = path.join(skillPath, 'locales')
    if (!fs.existsSync(localesPath)) {
      continue
    }

    const localeFiles = (await fs.promises.readdir(localesPath)).filter((file) =>
      file.endsWith('.json')
    )

    for (const file of localeFiles) {
      const localePath = path.join(localesPath, file)
      const localeConfig = JSON.parse(
        await fs.promises.readFile(localePath, 'utf8')
      ) as ObjectUnknown

      validateSchema(
        'skill-schemas/skill-locale-config',
        skillLocaleConfigObject as ObjectUnknown,
        localeConfig,
        `The skill locale schema "${localePath}" is not valid:`
      )
    }
  }
  LogHelper.success('Skills data schemas checked')

  process.exit(0)
})()
