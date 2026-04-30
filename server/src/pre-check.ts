import fs from 'node:fs'
import path from 'node:path'

import { AggregateAjvError } from '@segment/ajv-human-errors'

import { ajv } from '@/ajv'
import {
  amazonVoiceConfiguration,
  googleCloudVoiceConfiguration,
  watsonVoiceConfiguration,
  VoiceConfigurationSchema
} from '@/schemas/voice-config-schemas'
import {
  globalAnswersSchemaObject,
  GlobalAnswersSchema
} from '@/schemas/global-data-schemas'
import {
  skillSchemaObject,
  skillLocaleConfigObject,
  SkillSchema,
  SkillLocaleConfigSchema
} from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import {
  MINIMUM_REQUIRED_RAM,
  VOICE_CONFIG_PATH,
  GLOBAL_DATA_PATH
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'

interface ObjectUnknown {
  [key: string]: unknown
}

const validateSchema = (
  schemaName: string,
  schema: ObjectUnknown,
  contentToValidate: ObjectUnknown,
  customErrorMessage: string
): void => {
  const schemaFile = `${schemaName}.json`
  const validate = ajv.compile(schema)
  const isValidSchemaKey =
    typeof contentToValidate['$schema'] === 'string' &&
    contentToValidate['$schema'].endsWith(schemaFile)
  const isValid = validate(contentToValidate) && isValidSchemaKey
  if (!isValid) {
    LogHelper.error(customErrorMessage)
    if (!isValidSchemaKey) {
      LogHelper.error(
        `The schema key "$schema" is not valid. Expected "${schemaName}", but got "${contentToValidate['$schema']}".`
      )
    }
    LogHelper.error(customErrorMessage)
    const errors = new AggregateAjvError(validate.errors ?? [])
    for (const error of errors) {
      LogHelper.error(error.message)
    }
    process.exit(1)
  }
}

/**
 * Pre-checking
 *
 * - Ensure the system requirements are met
 * - Ensure JSON files are correctly formatted
 */

const VOICE_CONFIG_SCHEMAS = {
  amazon: amazonVoiceConfiguration,
  'google-cloud': googleCloudVoiceConfiguration,
  'watson-stt': watsonVoiceConfiguration,
  'watson-tts': watsonVoiceConfiguration
}
const GLOBAL_DATA_SCHEMAS = {
  answers: globalAnswersSchemaObject
}

;(async (): Promise<void> => {
  LogHelper.title('Pre-checking')

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
    const config: VoiceConfigurationSchema = JSON.parse(
      await fs.promises.readFile(voiceConfigPath, 'utf8')
    )
    const [configName] = file.split('.') as [keyof typeof VOICE_CONFIG_SCHEMAS]
    validateSchema(
      `voice-config-schemas/${configName}`,
      VOICE_CONFIG_SCHEMAS[configName],
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
    const answers: GlobalAnswersSchema = JSON.parse(
      await fs.promises.readFile(globalAnswersPath, 'utf8')
    )
    validateSchema(
      'global-data/global-answers',
      GLOBAL_DATA_SCHEMAS.answers,
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
    const skillObject: SkillSchema = JSON.parse(
      await fs.promises.readFile(pathToSkill, 'utf8')
    )
    validateSchema(
      'skill-schemas/skill',
      skillSchemaObject,
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
      const localeConfig: SkillLocaleConfigSchema = JSON.parse(
        await fs.promises.readFile(localePath, 'utf8')
      )
      validateSchema(
        'skill-schemas/skill-locale-config',
        skillLocaleConfigObject,
        localeConfig,
        `The skill locale schema "${localePath}" is not valid:`
      )
    }
  }
  LogHelper.success('Skills data schemas checked')

  process.exit(0)
})()
