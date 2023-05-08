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

interface SkillDomain {
  name: string
  path: string
  skills: {
    [key: string]: {
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

export class SkillDomainHelper {
  /**
   * List all skills domains with skills data inside
   */
  public static async getSkillDomains(): Promise<Map<string, SkillDomain>> {
    const skillDomains = new Map<string, SkillDomain>()

    await Promise.all(
      (
        await fs.promises.readdir(SKILLS_PATH)
      ).map(async (entity) => {
        const domainPath = path.join(SKILLS_PATH, entity)

        if ((await fs.promises.stat(domainPath)).isDirectory()) {
          const skills: SkillDomain['skills'] = {}
          const { name: domainName } = (await import(
            path.join(domainPath, 'domain.json')
          )) as DomainSchema
          const skillFolders = await fs.promises.readdir(domainPath)

          for (let i = 0; i < skillFolders.length; i += 1) {
            const skillAliasName = skillFolders[i] as string
            const skillPath = path.join(domainPath, skillAliasName)

            if ((await fs.promises.stat(skillPath)).isDirectory()) {
              const { name: skillName, bridge: skillBridge } = JSON.parse(
                await fs.promises.readFile(
                  path.join(skillPath, 'skill.json'),
                  'utf8'
                )
              ) as SkillSchema

              skills[skillName] = {
                name: skillAliasName,
                path: skillPath,
                bridge: skillBridge
              }
            }

            const skillDomain: SkillDomain = {
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
}
