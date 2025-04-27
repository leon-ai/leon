import fs from 'node:fs'
import path from 'node:path'

import type { ShortLanguageCode } from '@/types'
import type { GlobalEntitySchema } from '@/schemas/global-data-schemas'
import type {
  DomainSchema,
  SkillSchema,
  SkillConfigSchema,
  SkillBridgeSchema
} from '@/schemas/skill-schemas'
import { SKILLS_PATH } from '@/constants'
import { FileHelper } from '@/helpers/file-helper'

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

export class SkillDomainHelper {
  /**
   * List all skills domains with skills data inside
   */
  public static async getSkillDomains(): Promise<Map<string, SkillDomain>> {
    const skillDomains = new Map<string, SkillDomain>()

    await Promise.all(
      (await fs.promises.readdir(SKILLS_PATH)).map(async (entity) => {
        const domainPath = path.join(SKILLS_PATH, entity)

        if ((await fs.promises.stat(domainPath)).isDirectory()) {
          const skills: SkillDomain['skills'] = {}
          const { name: domainName } = (await FileHelper.dynamicImportFromFile(
            path.join(domainPath, 'domain.json'),
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

              const { name: skillName, bridge: skillBridge } = JSON.parse(
                await fs.promises.readFile(skillJSONPath, 'utf8')
              ) as SkillSchema

              skills[skillName] = {
                domainId,
                name: skillAliasName,
                path: skillPath,
                bridge: skillBridge
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
    const sharedDataPath = path.join(process.cwd(), 'core', 'data', lang)
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
    domain: SkillDomain['name'],
    skill: SkillSchema['name'],
    memory: string
  ): Promise<Record<string, unknown> | null> {
    const skillMemoryPath = path.join(
      SKILLS_PATH,
      domain,
      skill,
      'memory',
      `${memory}.json`
    )

    if (!fs.existsSync(skillMemoryPath)) {
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
}
