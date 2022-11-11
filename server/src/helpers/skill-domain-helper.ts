import fs from 'node:fs'
import path from 'node:path'

import type { ShortLanguageCode } from '@/helpers/lang-helper'
import type { GlobalEntity } from '@/schemas/global-data-schemas'
import type {
  Domain,
  Skill,
  SkillConfig,
  SkillBridge
} from '@/schemas/skill-schemas'

interface SkillDomain {
  name: string
  path: string
  skills: {
    [key: string]: {
      name: string
      path: string
      bridge: SkillBridge
    }
  }
}

interface SkillConfigWithGlobalEntities extends Omit<SkillConfig, 'entities'> {
  entities: Record<string, GlobalEntity>
}

const DOMAINS_DIR = path.join(process.cwd(), 'skills')

export class SkillDomainHelper {
  /**
   * List all skills domains with skills data inside
   */
  public static async getSkillDomains(): Promise<Map<string, SkillDomain>> {
    const skillDomains = new Map<string, SkillDomain>()

    await Promise.all(
      fs.readdirSync(DOMAINS_DIR).map(async (entity) => {
        const domainPath = path.join(DOMAINS_DIR, entity)

        if (fs.statSync(domainPath).isDirectory()) {
          const skills: SkillDomain['skills'] = {}
          const { name: domainName } = (await import(
            path.join(domainPath, 'domain.json')
          )) as Domain
          const skillFolders = fs.readdirSync(domainPath)

          for (let i = 0; i < skillFolders.length; i += 1) {
            const skillAliasName = skillFolders[i] as string
            const skillPath = path.join(domainPath, skillAliasName)

            if (fs.statSync(skillPath).isDirectory()) {
              const { name: skillName, bridge: skillBridge } = JSON.parse(
                fs.readFileSync(path.join(skillPath, 'skill.json'), 'utf8')
              ) as Skill

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
  public static getSkillDomainInfo(domain: SkillDomain['name']): Domain {
    return JSON.parse(
      fs.readFileSync(path.join(DOMAINS_DIR, domain, 'domain.json'), 'utf8')
    )
  }

  /**
   * Get information of a specific skill
   * @param domain Domain where the skill belongs
   * @param skill Skill to get info from
   */
  public static getSkillInfo(
    domain: SkillDomain['name'],
    skill: Skill['name']
  ): Skill {
    return JSON.parse(
      fs.readFileSync(
        path.join(DOMAINS_DIR, domain, skill, 'skill.json'),
        'utf8'
      )
    )
  }

  /**
   * Get skill config
   * @param configFilePath Path of the skill config file
   * @param lang Language short code
   */
  public static getSkillConfig(
    configFilePath: string,
    lang: ShortLanguageCode
  ): SkillConfigWithGlobalEntities {
    const sharedDataPath = path.join(process.cwd(), 'core', 'data', lang)
    const configData = JSON.parse(
      fs.readFileSync(configFilePath, 'utf8')
    ) as SkillConfig
    const result: SkillConfigWithGlobalEntities = {
      ...configData,
      entities: {}
    }
    const { entities } = configData

    // Load shared data entities if entity = 'xxx.json'
    if (entities) {
      const entitiesKeys = Object.keys(entities)

      entitiesKeys.forEach((entity) => {
        if (typeof entities[entity] === 'string') {
          const entityFilePath = path.join(
            sharedDataPath,
            entities[entity] as string
          )
          const entityRawData = fs.readFileSync(entityFilePath, {
            encoding: 'utf8'
          })

          result.entities[entity] = JSON.parse(entityRawData) as GlobalEntity
        }
      })

      configData.entities = entities
    }

    return result
  }
}
