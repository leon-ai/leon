import fs from 'node:fs'
import path from 'node:path'

import { AggregateAjvError } from '@segment/ajv-human-errors'

import { ajv } from '@/ajv'
import {
  amazonVoiceConfiguration,
  googleCloudVoiceConfiguration,
  watsonVoiceConfiguration,
  VoiceConfiguration
} from '@/schemas/voice-config-schemas'
import {
  globalAnswersSchemaObject,
  globalEntitySchemaObject,
  globalResolverSchemaObject,
  GlobalEntity,
  GlobalResolver,
  GlobalAnswers
} from '@/schemas/global-data-schemas'
import {
  domainSchemaObject,
  skillSchemaObject,
  skillConfigSchemaObject,
  Domain,
  Skill,
  SkillConfig
} from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { VOICE_CONFIG_PATH, GLOBAL_DATA_PATH } from '@/constants'
import { getGlobalEntitiesPath, getGlobalResolversPath } from '@/utilities'

interface ObjectUnknown {
  [key: string]: unknown
}

const validateSchema = (
  schema: ObjectUnknown,
  contentToValidate: ObjectUnknown,
  customErrorMesage: string
): void => {
  const validate = ajv.compile(schema)
  const isValid = validate(contentToValidate)
  if (!isValid) {
    const errors = new AggregateAjvError(validate.errors ?? [])
    const messages: string[] = []
    for (const error of errors) {
      messages.push(error.message)
    }
    LogHelper.error(customErrorMesage)
    LogHelper.error(messages.join('\n'))
    process.exit(1)
  }
}

/**
 * Pre-checking
 * Ensure JSON files are correctly formatted
 */
const VOICE_CONFIG_SCHEMAS = {
  amazon: amazonVoiceConfiguration,
  'google-cloud': googleCloudVoiceConfiguration,
  'watson-stt': watsonVoiceConfiguration,
  'watson-tts': watsonVoiceConfiguration
}
const GLOBAL_DATA_SCHEMAS = {
  answers: globalAnswersSchemaObject,
  globalEntities: globalEntitySchemaObject,
  globalResolvers: globalResolverSchemaObject
}

;(async (): Promise<void> => {
  LogHelper.title('Pre-checking')

  /**
   * Voice configuration checking
   */
  LogHelper.info('Checking voice configuration schemas...')

  const voiceConfigFiles = (
    await fs.promises.readdir(VOICE_CONFIG_PATH)
  ).filter((file) => file.endsWith('.json'))

  for (const file of voiceConfigFiles) {
    const config: VoiceConfiguration = JSON.parse(
      await fs.promises.readFile(path.join(VOICE_CONFIG_PATH, file), 'utf8')
    )
    const [configName] = file.split('.') as [keyof typeof VOICE_CONFIG_SCHEMAS]
    validateSchema(
      VOICE_CONFIG_SCHEMAS[configName],
      config,
      `The voice configuration schema "${file}" is not valid:`
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
     * Global entities checking
     */
    const globalEntitiesPath = getGlobalEntitiesPath(lang)
    const globalEntityFiles = (
      await fs.promises.readdir(globalEntitiesPath)
    ).filter((file) => file.endsWith('.json'))

    for (const file of globalEntityFiles) {
      const globalEntity: GlobalEntity = JSON.parse(
        await fs.promises.readFile(path.join(globalEntitiesPath, file), 'utf8')
      )
      validateSchema(
        globalEntitySchemaObject,
        globalEntity,
        `The global entity schema "${file}" is not valid:`
      )
    }

    /**
     * Global resolvers checking
     */
    const globalResolversPath = getGlobalResolversPath(lang)
    const globalResolverFiles = (
      await fs.promises.readdir(globalResolversPath)
    ).filter((file) => file.endsWith('.json'))

    for (const file of globalResolverFiles) {
      const globalResolver: GlobalResolver = JSON.parse(
        await fs.promises.readFile(path.join(globalResolversPath, file), 'utf8')
      )
      validateSchema(
        globalResolverSchemaObject,
        globalResolver,
        `The global resolver schema "${file}" is not valid:`
      )
    }

    /**
     * Global answers checking
     */
    const answers: GlobalAnswers = JSON.parse(
      await fs.promises.readFile(
        path.join(GLOBAL_DATA_PATH, lang, 'answers.json'),
        'utf8'
      )
    )
    validateSchema(
      GLOBAL_DATA_SCHEMAS.answers,
      answers,
      `The global answers schema "answers.json" is not valid:`
    )
  }
  LogHelper.success('Global data schemas checked')

  /**
   * Skills data checking
   */
  LogHelper.info('Checking skills data schemas...')

  const skillDomains = await SkillDomainHelper.getSkillDomains()

  for (const [, currentDomain] of skillDomains) {
    /**
     * Domain checking
     */
    const pathToDomain = path.join(currentDomain.path, 'domain.json')
    const domainObject: Domain = JSON.parse(
      await fs.promises.readFile(pathToDomain, 'utf8')
    )
    validateSchema(
      domainSchemaObject,
      domainObject,
      `The domain schema "${pathToDomain}" is not valid:`
    )

    const skillKeys = Object.keys(currentDomain.skills)

    for (const skillKey of skillKeys) {
      const currentSkill = currentDomain.skills[skillKey]

      /**
       * Skills checking
       */
      if (currentSkill) {
        const pathToSkill = path.join(currentSkill.path, 'skill.json')
        const skillObject: Skill = JSON.parse(
          await fs.promises.readFile(pathToSkill, 'utf8')
        )
        validateSchema(
          skillSchemaObject,
          skillObject,
          `The skill schema "${pathToSkill}" is not valid:`
        )

        /**
         * Skills config checking
         */
        const pathToSkillConfig = path.join(currentSkill.path, 'config')
        const skillConfigFiles = (
          await fs.promises.readdir(pathToSkillConfig)
        ).filter((file) => file.endsWith('.json'))

        for (const file of skillConfigFiles) {
          const skillConfigPath = path.join(pathToSkillConfig, file)
          const skillConfig: SkillConfig = JSON.parse(
            await fs.promises.readFile(skillConfigPath, 'utf8')
          )
          validateSchema(
            skillConfigSchemaObject,
            skillConfig,
            `The skill config schema "${skillConfigPath}" is not valid:`
          )
        }
      }
    }
  }
  LogHelper.success('Skills data schemas checked')

  process.exit(0)
})()
