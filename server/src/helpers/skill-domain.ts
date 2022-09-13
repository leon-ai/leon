import fs from 'fs'
import path from 'path'

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

export function getSkillDomainInfo(domain: SkillDomain['name']) {
  return JSON.parse(
    fs.readFileSync(path.join(DOMAINS_DIR, domain, 'domain.json'), 'utf8')
  )
}

export function getSkillInfo(
  domain: SkillDomain['name'],
  skill: Skill['name']
) {
  return JSON.parse(
    fs.readFileSync(path.join(DOMAINS_DIR, domain, skill, 'skill.json'), 'utf8')
  )
}
