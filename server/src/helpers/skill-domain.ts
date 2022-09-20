import fs from 'fs'
import path from 'path'

import type { ShortLanguageCode } from '@/helpers/lang'

enum SkillBridges {
  Python = 'python'
}

interface SkillConfig {
  answers?: Record<string, string[]>
  entities?: Record<string, string>
  variables?: Record<string, string>
  actions: Record<
    string,
    {
      type: 'logic' | 'dialog'
      utterance_samples?: string[]
      answers?: string[]
      unknown_answers?: string[]
      suggestions?: string[]
      next_action?: string
    }
  >
}

interface GlobalEntity {
  options: Record<
    string,
    {
      synonyms: string[]
      data: Record<string, string[]>
    }
  >
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

/**
 * List all skills domains with skills data inside
 */
export async function getSkillDomains() {
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
 *
 * @param domain Domain to get info from
 */
export function getSkillDomainInfo(domain: SkillDomain['name']) {
  return JSON.parse(
    fs.readFileSync(path.join(DOMAINS_DIR, domain, 'domain.json'), 'utf8')
  )
}

/**
 * Get information of a specific skill
 *
 * @param domain Domain where the skill belongs
 * @param skill Skill to get info from
 */
export function getSkillInfo(
  domain: SkillDomain['name'],
  skill: Skill['name']
) {
  return JSON.parse(
    fs.readFileSync(path.join(DOMAINS_DIR, domain, skill, 'skill.json'), 'utf8')
  )
}

export interface GetSkillConfigOptions {
  domain: SkillDomain['name']
  skill: Skill['name']
  lang: ShortLanguageCode
}

export interface SkillConfigWithGlobalEntities
  extends Omit<SkillConfig, 'entities'> {
  entities: Record<string, GlobalEntity>
}

/**
 * Get skill config
 *
 * @param options Information about the skill to get config from
 * @returns Skill config with global entities loaded or null if the config is not found
 */
export async function getSkillConfig(
  options: GetSkillConfigOptions
): Promise<SkillConfigWithGlobalEntities | null> {
  const { domain, skill, lang } = options
  const configFilePath = path.join(
    process.cwd(),
    'skills',
    domain,
    skill,
    'config',
    `${lang}.json`
  )
  if (!fs.existsSync(configFilePath)) {
    return null
  }
  const sharedDataPath = path.join(process.cwd(), 'core', 'data', lang)
  const configRawData = await fs.promises.readFile(configFilePath, {
    encoding: 'utf8'
  })
  const configData = JSON.parse(configRawData) as SkillConfig
  const result: SkillConfigWithGlobalEntities = {
    ...configData,
    entities: {}
  }
  if (configData.entities != null) {
    const entitiesKeys = Object.keys(configData.entities)
    for (const entity of entitiesKeys) {
      if (typeof configData.entities[entity] === 'string') {
        const entityFilePath = path.join(
          sharedDataPath,
          configData.entities[entity] as string
        )
        const entityRawData = await fs.promises.readFile(entityFilePath, {
          encoding: 'utf8'
        })
        const entityData = JSON.parse(entityRawData) as GlobalEntity
        result.entities[entity] = entityData
      }
    }
  }
  return result
}
