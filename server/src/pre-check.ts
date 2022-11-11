import fs from 'node:fs'
import path from 'node:path'

import { TypeCompiler } from '@sinclair/typebox/compiler'

import {
  amazonVoiceConfiguration,
  googleCloudVoiceConfiguration,
  watsonVoiceConfiguration
} from '@/schemas/voice-config-schemas'
import {
  answersSchemaObject,
  globalEntitySchemaObject,
  globalResolverSchemaObject
} from '@/schemas/global-data-schemas'
import {
  domainSchemaObject,
  skillSchemaObject,
  skillConfigSchemaObject
} from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { VOICE_CONFIG_PATH, GLOBAL_DATA_PATH } from '@/constants'
import { getGlobalEntitiesPath, getGlobalResolversPath } from '@/utilities'

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
  answers: answersSchemaObject,
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
  ).filter((file) => file.endsWith('.json') && !file.includes('.sample.'))

  for (const file of voiceConfigFiles) {
    const config = JSON.parse(
      await fs.promises.readFile(path.join(VOICE_CONFIG_PATH, file), 'utf8')
    )
    const [configName] = file.split('.') as [keyof typeof VOICE_CONFIG_SCHEMAS]
    const result = TypeCompiler.Compile(VOICE_CONFIG_SCHEMAS[configName])
    const errors = [...result.Errors(config)]

    if (errors.length > 0) {
      LogHelper.error(`The voice configuration schema "${file}" is not valid:`)
      LogHelper.error(JSON.stringify(errors, null, 2))
      process.exit(1)
    }
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
      const globalEntity = JSON.parse(
        await fs.promises.readFile(path.join(globalEntitiesPath, file), 'utf8')
      )
      const result = TypeCompiler.Compile(globalEntitySchemaObject)
      const errors = [...result.Errors(globalEntity)]

      if (errors.length > 0) {
        LogHelper.error(`The global entity schema "${file}" is not valid:`)
        LogHelper.error(JSON.stringify(errors, null, 2))
        process.exit(1)
      }
    }

    /**
     * Global resolvers checking
     */
    const globalResolversPath = getGlobalResolversPath(lang)
    const globalResolverFiles = (
      await fs.promises.readdir(globalResolversPath)
    ).filter((file) => file.endsWith('.json'))

    for (const file of globalResolverFiles) {
      const globalResolver = JSON.parse(
        await fs.promises.readFile(path.join(globalResolversPath, file), 'utf8')
      )
      const result = TypeCompiler.Compile(globalResolverSchemaObject)
      const errors = [...result.Errors(globalResolver)]

      if (errors.length > 0) {
        LogHelper.error(`The global resolver schema "${file}" is not valid:`)
        LogHelper.error(JSON.stringify(errors, null, 2))
        process.exit(1)
      }
    }

    /**
     * Global answers checking
     */
    const answers = JSON.parse(
      await fs.promises.readFile(
        path.join(GLOBAL_DATA_PATH, lang, 'answers.json'),
        'utf8'
      )
    )
    const result = TypeCompiler.Compile(GLOBAL_DATA_SCHEMAS.answers)

    const errors = [...result.Errors(answers)]

    if (errors.length > 0) {
      LogHelper.error(`The global answers schema "answers.json" is not valid:`)
      LogHelper.error(JSON.stringify(errors, null, 2))
      process.exit(1)
    }
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
    const domainObject = JSON.parse(
      await fs.promises.readFile(pathToDomain, 'utf8')
    )
    const domainResult = TypeCompiler.Compile(domainSchemaObject)
    const domainErrors = [...domainResult.Errors(domainObject)]

    if (domainErrors.length > 0) {
      LogHelper.error(`The domain schema "${pathToDomain}" is not valid:`)
      LogHelper.error(JSON.stringify(domainErrors, null, 2))
      process.exit(1)
    }

    const skillKeys = Object.keys(currentDomain.skills)

    for (const skillKey of skillKeys) {
      const currentSkill = currentDomain.skills[skillKey]

      /**
       * Skills checking
       */
      if (currentSkill) {
        const pathToSkill = path.join(currentSkill.path, 'skill.json')
        const skillObject = JSON.parse(
          await fs.promises.readFile(pathToSkill, 'utf8')
        )
        const skillResult = TypeCompiler.Compile(skillSchemaObject)
        const skillErrors = [...skillResult.Errors(skillObject)]

        if (skillErrors.length > 0) {
          LogHelper.error(`The skill schema "${pathToSkill}" is not valid:`)
          LogHelper.error(JSON.stringify(skillErrors, null, 2))
          process.exit(1)
        }

        /**
         * Skills config checking
         */
        const pathToSkillConfig = path.join(currentSkill.path, 'config')
        const skillConfigFiles = (
          await fs.promises.readdir(pathToSkillConfig)
        ).filter((file) => file.endsWith('.json'))

        for (const file of skillConfigFiles) {
          const skillConfigPath = path.join(pathToSkillConfig, file)
          const skillConfig = JSON.parse(
            await fs.promises.readFile(skillConfigPath, 'utf8')
          )
          const result = TypeCompiler.Compile(skillConfigSchemaObject)
          const errors = [...result.Errors(skillConfig)]

          if (errors.length > 0) {
            LogHelper.error(
              `The skill config schema "${skillConfigPath}" is not valid:`
            )
            LogHelper.error(JSON.stringify(errors, null, 2))
            process.exit(1)
          }
        }
      }
    }
  }
  LogHelper.success('Skills data schemas checked')

  process.exit(0)
})()
