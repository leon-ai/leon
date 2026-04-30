import fs from 'node:fs'
import path from 'node:path'

import type { ShortLanguageCode } from '@/types'
import type { GlobalEntitySchema } from '@/schemas/global-data-schemas'
import type {
  DomainSchema,
  SkillSchema,
  SkillConfigSchema,
  SkillBridgeSchema,
  SkillLocaleConfigSchema
} from '@/schemas/skill-schemas'
import {
  GLOBAL_DATA_PATH,
  PROFILE_SKILLS_PATH,
  SKILLS_PATH
} from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { ProfileHelper } from '@/helpers/profile-helper'

interface SkillDomain {
  domainId: string
  name: string
  path: string
  skills: {
    [key: string]: {
      domainId: string
      name: string
      path: string
      bridge: SkillBridgeSchema
      friendlyPrompt: string
    }
  }
}

interface SkillConfigWithGlobalEntities
  extends Omit<SkillConfigSchema, 'entities'> {
  entities: Record<string, GlobalEntitySchema>
}

interface SkillActionObject {
  domain: string
  skill: string
  action: string
}

const SKILL_NAME_SUFFIX = '_skill'

export class SkillDomainHelper {
  public static normalizeSkillName(skillName: string): string {
    const normalizedSkillName = skillName.trim().toLowerCase()

    if (!normalizedSkillName) {
      return ''
    }

    return normalizedSkillName.endsWith(SKILL_NAME_SUFFIX)
      ? normalizedSkillName
      : `${normalizedSkillName}${SKILL_NAME_SUFFIX}`
  }

  public static getSkillCommandName(skillName: string): string {
    return skillName.endsWith(SKILL_NAME_SUFFIX)
      ? skillName.slice(0, -SKILL_NAME_SUFFIX.length)
      : skillName
  }

  /**
   * List all skill folders
   */
  public static listSkillFoldersSync(): string[] {
    const skillFolders = new Set<string>()

    for (const skillsPath of [SKILLS_PATH, PROFILE_SKILLS_PATH]) {
      if (!fs.existsSync(skillsPath)) {
        continue
      }

      for (const folder of fs.readdirSync(skillsPath)) {
        if (
          folder.endsWith(SKILL_NAME_SUFFIX) &&
          !ProfileHelper.isSkillDisabled(folder)
        ) {
          skillFolders.add(folder)
        }
      }
    }

    return [...skillFolders].sort()
  }

  public static async listSkillFolders(): Promise<string[]> {
    return this.listSkillFoldersSync()
  }

  /**
   * TODO: rename this function when legacy getSkillConfig is removed
   *
   * Get skill configuration (skill.json)
   * @param skillName Skill name to get configuration for
   */
  public static async getNewSkillConfig(
    skillName: SkillSchema['name']
  ): Promise<SkillSchema | null> {
    const skillConfigPath = SkillDomainHelper.getNewSkillConfigPath(skillName)

    if (!skillConfigPath) {
      return null
    }

    return JSON.parse(
      await fs.promises.readFile(skillConfigPath, 'utf8')
    ) as SkillSchema
  }

  public static getNewSkillConfigSync(
    skillName: SkillSchema['name']
  ): SkillSchema | null {
    const skillConfigPath = SkillDomainHelper.getNewSkillConfigPath(skillName)

    if (!skillConfigPath) {
      return null
    }

    return JSON.parse(fs.readFileSync(skillConfigPath, 'utf8')) as SkillSchema
  }

  /**
   * TODO: rename this function when legacy helpers are removed
   *
   * Get new skill config path
   * @param skillName Skill name to get configuration for
   */
  public static getNewSkillConfigPath(
    skillName: SkillSchema['name']
  ): string | null {
    const skillPath = this.resolveSkillPath(skillName)

    if (!skillPath) {
      return null
    }

    const skillConfigPath = path.join(skillPath, 'skill.json')

    if (!fs.existsSync(skillConfigPath)) {
      return null
    }

    return skillConfigPath
  }

  /**
   * Resolve a skill source path for the active profile.
   * Profile-installed skills override built-in skills with the same ID.
   * @param skillName Skill name to resolve
   */
  public static resolveSkillPath(skillName: SkillSchema['name']): string | null {
    if (ProfileHelper.isSkillDisabled(skillName)) {
      return null
    }

    for (const skillsPath of [PROFILE_SKILLS_PATH, SKILLS_PATH]) {
      const skillPath = path.join(skillsPath, skillName)
      const skillConfigPath = path.join(skillPath, 'skill.json')

      if (fs.existsSync(skillConfigPath)) {
        return skillPath
      }
    }

    return null
  }

  /**
   * Get skill guidance path (SKILL.md)
   * @param skillName Skill name to get guidance path from
   */
  public static getSkillGuidancePath(
    skillName: SkillSchema['name']
  ): string | null {
    const skillPath = this.resolveSkillPath(skillName)

    if (!skillPath) {
      return null
    }

    const skillGuidancePath = path.join(skillPath, 'SKILL.md')

    if (!fs.existsSync(skillGuidancePath)) {
      return null
    }

    return skillGuidancePath
  }

  /**
   * Get skill guidance (SKILL.md)
   * @param skillName Skill name to get guidance for
   */
  public static async getSkillGuidance(
    skillName: SkillSchema['name']
  ): Promise<string | null> {
    const skillGuidancePath = SkillDomainHelper.getSkillGuidancePath(skillName)

    if (!skillGuidancePath) {
      return null
    }

    const guidance = await fs.promises.readFile(skillGuidancePath, 'utf8')
    const trimmedGuidance = guidance.trim()

    return trimmedGuidance === '' ? null : trimmedGuidance
  }

  /**
   * List all skills friendly prompts
   */
  public static async listSkillFriendlyPrompts(): Promise<string[]> {
    const skillNames = await SkillDomainHelper.listSkillFolders()
    const skillFriendlyPrompts: string[] = []

    await Promise.all(
      skillNames.map(async (skillName) => {
        const skillConfig = await SkillDomainHelper.getNewSkillConfig(skillName)

        if (skillConfig && skillConfig.description) {
          skillFriendlyPrompts.push(`${skillName}: ${skillConfig.description}`)
        }
      })
    )

    skillFriendlyPrompts.sort()

    return skillFriendlyPrompts
  }

  /**
   * List all skill domains with skill data inside
   */
  public static async getSkillDomains(): Promise<Map<string, SkillDomain>> {
    const skillDomains = new Map<string, SkillDomain>()

    await Promise.all(
      (await fs.promises.readdir(SKILLS_PATH)).map(async (entity) => {
        const domainPath = path.join(SKILLS_PATH, entity)

        if ((await fs.promises.stat(domainPath)).isDirectory()) {
          const domainSchemaPath = path.join(domainPath, 'domain.json')
          if (!fs.existsSync(domainSchemaPath)) {
            return null
          }

          const skills: SkillDomain['skills'] = {}
          const { name: domainName } = (await FileHelper.dynamicImportFromFile(
            domainSchemaPath,
            { with: { type: 'json' } }
          )) as DomainSchema
          const skillFolders = await fs.promises.readdir(domainPath)
          const domainPathParts = domainPath.split('/')
          const domainId = domainPathParts[domainPathParts.length - 1] as string

          for (let i = 0; i < skillFolders.length; i += 1) {
            const skillAliasName = skillFolders[i] as string
            const skillPath = path.join(domainPath, skillAliasName)

            if ((await fs.promises.stat(skillPath)).isDirectory()) {
              const skillJSONPath = path.join(skillPath, 'skill.json')

              if (!fs.existsSync(skillJSONPath)) {
                continue
              }

              const {
                name: skillName,
                bridge: skillBridge,
                description: skillDescription
              } = JSON.parse(
                await fs.promises.readFile(skillJSONPath, 'utf8')
              ) as SkillSchema

              skills[skillName] = {
                domainId,
                name: skillAliasName,
                path: skillPath,
                bridge: skillBridge,
                friendlyPrompt: `${skillAliasName}_skill: ${skillDescription}`
              }
            }

            const skillDomain: SkillDomain = {
              domainId,
              name: entity,
              path: domainPath,
              skills
            }
            skillDomains.set(domainName, skillDomain)
          }
        }

        return null
      })
    )

    return skillDomains
  }

  /**
   * Get information of a specific domain
   * @param domain Domain to get info from
   */
  public static async getSkillDomainInfo(
    domain: SkillDomain['name']
  ): Promise<DomainSchema> {
    return JSON.parse(
      await fs.promises.readFile(
        path.join(SKILLS_PATH, domain, 'domain.json'),
        'utf8'
      )
    )
  }

  /**
   * Get information of a specific skill
   * @param domain Domain where the skill belongs
   * @param skill Skill to get info from
   */
  public static async getSkillInfo(
    domain: SkillDomain['name'],
    skill: SkillSchema['name']
  ): Promise<SkillSchema> {
    return JSON.parse(
      await fs.promises.readFile(
        path.join(SKILLS_PATH, domain, skill, 'skill.json'),
        'utf8'
      )
    )
  }

  /**
   * Get skill path
   * @param domain Domain where the skill belongs
   * @param skill Skill to get path from
   */
  public static getSkillPath(
    domain: SkillDomain['name'],
    skill: SkillSchema['name']
  ): string {
    return path.join(SKILLS_PATH, domain, skill)
  }

  /**
   * Get skill config path
   * @param domain Domain where the skill belongs
   * @param skill Skill to get config path from
   * @param lang Language short code
   */
  public static getSkillConfigPath(
    domain: SkillDomain['name'],
    skill: SkillSchema['name'],
    lang: ShortLanguageCode
  ): string {
    return path.join(SKILLS_PATH, domain, skill, 'config', `${lang}.json`)
  }

  /**
   * Get skill config
   * @param configFilePath Path of the skill config file
   * @param lang Language short code
   */
  public static async getSkillConfig(
    configFilePath: string,
    lang: ShortLanguageCode
  ): Promise<SkillConfigWithGlobalEntities> {
    const sharedDataPath = path.join(GLOBAL_DATA_PATH, lang)
    const configData = JSON.parse(
      await fs.promises.readFile(configFilePath, 'utf8')
    ) as SkillConfigSchema
    const result: SkillConfigWithGlobalEntities = {
      ...configData,
      entities: {}
    }
    const { entities } = configData

    // Load shared data entities if entity = 'xxx.json'
    if (entities) {
      const entitiesKeys = Object.keys(entities)

      await Promise.all(
        entitiesKeys.map(async (entity) => {
          if (typeof entities[entity] === 'string') {
            const entityFilePath = path.join(
              sharedDataPath,
              entities[entity] as string
            )
            const entityRawData = await fs.promises.readFile(entityFilePath, {
              encoding: 'utf8'
            })

            result.entities[entity] = JSON.parse(
              entityRawData
            ) as GlobalEntitySchema
          }
        })
      )

      configData.entities = entities
    }

    return result
  }

  /**
   * Get a memory from a skill
   * @param domain Domain where the skill belongs
   * @param skill Skill to get memory from
   * @param memory Memory name
   */
  public static async getSkillMemory(
    _domain: SkillDomain['name'],
    skill: SkillSchema['name'],
    memory: string
  ): Promise<Record<string, unknown> | null> {
    const normalizedSkillName = this.normalizeSkillName(skill)
    const skillMemoryCandidates = [
      path.join(PROFILE_SKILLS_PATH, normalizedSkillName, 'memory', `${memory}.json`)
    ]
    const skillMemoryPath = skillMemoryCandidates.find((candidate) =>
      fs.existsSync(candidate)
    )

    if (!skillMemoryPath) {
      return null
    }

    return JSON.parse(await fs.promises.readFile(skillMemoryPath, 'utf-8'))
  }

  /**
   * Verify if an action exists
   * @param lang Language short code
   * @param params Action to verify
   * @example actionExists('food_drink.advisor.suggest') // true
   * @example actionExists({ domain: 'food_drink', skill: 'advisor', action: 'suggest' }) // true
   */
  public static async actionExists(
    lang: ShortLanguageCode,
    params: string | SkillActionObject
  ): Promise<boolean> {
    const { domain, skill, action } =
      typeof params === 'string'
        ? {
            domain: params.split('.')[0],
            skill: params.split('.')[1],
            action: params.split('.')[2]
          }
        : params

    if (!domain || !skill || !action) {
      return false
    }

    const skillPath = path.join(SKILLS_PATH, domain, skill)
    if (!fs.existsSync(skillPath)) {
      return false
    }

    const skillConfigPath = path.join(skillPath, 'config', `${lang}.json`)
    if (!fs.existsSync(skillConfigPath)) {
      return false
    }

    const { actions } = JSON.parse(
      await fs.promises.readFile(skillConfigPath, 'utf8')
    ) as SkillConfigSchema

    return !!actions[action]
  }

  /**
   * Get localized configuration of a skill action
   * @param lang Language short code
   * @param skillName Skill name to get configuration for
   * @example getSkillLocaleConfig('en', 'color_skill')['actions'][actionName]
   */
  public static async getSkillLocaleConfig(
    lang: ShortLanguageCode,
    skillName: SkillSchema['name']
  ): Promise<SkillLocaleConfigSchema | object> {
    const skillPath = this.resolveSkillPath(skillName)

    if (!skillPath) {
      return {}
    }

    const skillLocaleConfigPath = path.join(
      skillPath,
      'locales',
      `${lang}.json`
    )

    if (!fs.existsSync(skillLocaleConfigPath)) {
      return {}
    }

    try {
      const skillLocaleConfig = JSON.parse(
        await fs.promises.readFile(skillLocaleConfigPath, 'utf8')
      )

      return skillLocaleConfig
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return {}
    }
  }
}
