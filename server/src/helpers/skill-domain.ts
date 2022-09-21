import fs from 'fs'
import path from 'path'

import type { ShortLanguageCode } from '@/helpers/lang'

enum SkillBridges {
  Python = 'python'
}

interface Skill {
  name: string
  path: string
  bridge: `${SkillBridges}`
}

interface SkillDomain {
  name: string
  path: string
  skills: {
    [key: string]: Skill
  }
}

const DOMAINS_DIR = path.join(process.cwd(), 'skills')

class SkillDomainHelper {
  private static instance: SkillDomainHelper

  private constructor() {
    // Singleton
  }

  public static getInstance() {
    if (SkillDomainHelper.instance == null) {
      SkillDomainHelper.instance = new SkillDomainHelper()
    }

    return SkillDomainHelper.instance
  }

  /**
   * List all skills domains with skills data inside
   */
  public async getSkillDomains() {
    const skillDomains = new Map<string, SkillDomain>()

    await Promise.all(
      fs.readdirSync(DOMAINS_DIR).map(async (entity) => {
        const domainPath = path.join(DOMAINS_DIR, entity)

        if (fs.statSync(domainPath).isDirectory()) {
          const skills: SkillDomain['skills'] = {}
          const { name: domainName } = (await import(
            path.join(domainPath, 'domain.json')
          )) as SkillDomain
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
  public getSkillDomainInfo(domain: SkillDomain['name']) {
    return JSON.parse(
      fs.readFileSync(path.join(DOMAINS_DIR, domain, 'domain.json'), 'utf8')
    )
  }

  /**
   * Get information of a specific skill
   * @param domain Domain where the skill belongs
   * @param skill Skill to get info from
   */
  public getSkillInfo(domain: SkillDomain['name'], skill: Skill['name']) {
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
  public getSkillConfig(configFilePath: string, lang: ShortLanguageCode) {
    const sharedDataPath = path.join(process.cwd(), 'core/data', lang)
    const configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
    const { entities } = configData

    // Load shared data entities if entity = 'xxx.json'
    if (entities) {
      const entitiesKeys = Object.keys(entities)

      entitiesKeys.forEach((entity) => {
        if (typeof entities[entity] === 'string') {
          entities[entity] = JSON.parse(
            fs.readFileSync(path.join(sharedDataPath, entities[entity]), 'utf8')
          )
        }
      })

      configData.entities = entities
    }

    return configData
  }
}

export const SKILL_DOMAIN = SkillDomainHelper.getInstance()
