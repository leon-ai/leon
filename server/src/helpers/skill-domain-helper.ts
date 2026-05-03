import fs from 'node:fs'
import path from 'node:path'

import { SkillFormat, type ShortLanguageCode } from '@/types'
import type { GlobalEntitySchema } from '@/schemas/global-data-schemas'
import type {
  DomainSchema,
  SkillSchema,
  SkillConfigSchema,
  SkillBridgeSchema,
  SkillLocaleConfigSchema
} from '@/schemas/skill-schemas'
import {
  AGENT_SKILLS_PATH,
  GLOBAL_DATA_PATH,
  NATIVE_SKILLS_PATH,
  PROFILE_AGENT_SKILLS_PATH,
  PROFILE_NATIVE_SKILLS_PATH,
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

interface SkillLookupOptions {
  includeDisabled?: boolean
}

interface AgentSkillFrontmatter {
  name: string
  description: string
}

export interface SkillDescriptor {
  id: string
  commandName: string
  name: string
  description: string
  iconName: string
  version: string
  format: SkillFormat
  path: string
}

export interface AgentSkillExecutionContext {
  id: string
  name: string
  description: string
  rootPath: string
  skillPath: string
  instructions: string
}

const SKILL_NAME_SUFFIX = '_skill'
const SKILL_CONFIG_FILENAME = 'skill.json'
const AGENT_SKILL_FILENAME = 'SKILL.md'
const AGENT_SKILL_FRONTMATTER_BOUNDARY = '---'
const AGENT_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const AGENT_SKILL_NAME_MAX_LENGTH = 64
const AGENT_SKILL_DESCRIPTION_MAX_LENGTH = 1_024
const AGENT_SKILL_ICON_NAME = 'ri-apps-ai-line'
const AGENT_SKILL_VERSION = '1.0.0'

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

  private static getNativeSkillRootPaths(): string[] {
    return [NATIVE_SKILLS_PATH, PROFILE_NATIVE_SKILLS_PATH]
  }

  private static getProfileFirstNativeSkillRootPaths(): string[] {
    return [PROFILE_NATIVE_SKILLS_PATH, NATIVE_SKILLS_PATH]
  }

  private static getAgentSkillRootPaths(): string[] {
    return [AGENT_SKILLS_PATH, PROFILE_AGENT_SKILLS_PATH]
  }

  private static normalizeAgentSkillFrontmatterValue(value: string): string {
    const trimmedValue = value.trim()

    if (
      (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
      (trimmedValue.startsWith('\'') && trimmedValue.endsWith('\''))
    ) {
      return trimmedValue.slice(1, -1).trim()
    }

    return trimmedValue
  }

  private static parseAgentSkillFrontmatter(
    content: string
  ): AgentSkillFrontmatter | null {
    const lines = content.replace(/\r\n/g, '\n').split('\n')

    if (lines[0]?.trim() !== AGENT_SKILL_FRONTMATTER_BOUNDARY) {
      return null
    }

    const boundaryIndex = lines.findIndex(
      (line, index) =>
        index > 0 && line.trim() === AGENT_SKILL_FRONTMATTER_BOUNDARY
    )

    if (boundaryIndex === -1) {
      return null
    }

    const metadata = new Map<string, string>()
    const frontmatterLines = lines.slice(1, boundaryIndex)

    for (const line of frontmatterLines) {
      const separatorIndex = line.indexOf(':')

      if (separatorIndex === -1) {
        continue
      }

      const key = line.slice(0, separatorIndex).trim()
      const value = this.normalizeAgentSkillFrontmatterValue(
        line.slice(separatorIndex + 1)
      )

      if (key) {
        metadata.set(key, value)
      }
    }

    const name = metadata.get('name') || ''
    const description = metadata.get('description') || ''

    if (
      !AGENT_SKILL_NAME_PATTERN.test(name) ||
      name.length > AGENT_SKILL_NAME_MAX_LENGTH ||
      description.length === 0 ||
      description.length > AGENT_SKILL_DESCRIPTION_MAX_LENGTH
    ) {
      return null
    }

    return { name, description }
  }

  private static getAgentSkillFrontmatterFromPath(
    skillPath: string
  ): AgentSkillFrontmatter | null {
    const skillMarkdownPath = path.join(skillPath, AGENT_SKILL_FILENAME)

    if (!fs.existsSync(skillMarkdownPath)) {
      return null
    }

    return this.parseAgentSkillFrontmatter(
      fs.readFileSync(skillMarkdownPath, 'utf8')
    )
  }

  /**
   * List all skill folders, including disabled skills.
   */
  public static listAllSkillFoldersSync(): string[] {
    const skillFolders = new Set<string>()

    for (const skillsPath of this.getNativeSkillRootPaths()) {
      if (!fs.existsSync(skillsPath)) {
        continue
      }

      for (const folder of fs.readdirSync(skillsPath)) {
        const skillConfigPath = path.join(
          skillsPath,
          folder,
          SKILL_CONFIG_FILENAME
        )

        if (
          folder.endsWith(SKILL_NAME_SUFFIX) &&
          fs.existsSync(skillConfigPath)
        ) {
          skillFolders.add(folder)
        }
      }
    }

    return [...skillFolders].sort()
  }

  /**
   * List enabled skill folders.
   */
  public static listSkillFoldersSync(): string[] {
    return this.listAllSkillFoldersSync().filter(
      (folder) => !ProfileHelper.isSkillDisabled(folder)
    )
  }

  public static async listSkillFolders(): Promise<string[]> {
    return this.listSkillFoldersSync()
  }

  /**
   * List all native and Agent Skill descriptors, including disabled skills.
   * Profile-installed skills override built-in skills with the same ID.
   */
  public static listAllSkillDescriptorsSync(): SkillDescriptor[] {
    const descriptors = new Map<string, SkillDescriptor>()

    for (const skillsPath of this.getNativeSkillRootPaths()) {
      if (!fs.existsSync(skillsPath)) {
        continue
      }

      for (const folder of fs.readdirSync(skillsPath)) {
        const skillPath = path.join(skillsPath, folder)

        if (!fs.statSync(skillPath).isDirectory()) {
          continue
        }

        const skillConfigPath = path.join(skillPath, SKILL_CONFIG_FILENAME)
        if (fs.existsSync(skillConfigPath)) {
          try {
            const skillConfig = JSON.parse(
              fs.readFileSync(skillConfigPath, 'utf8')
            ) as SkillSchema

            descriptors.set(folder, {
              id: folder,
              commandName: this.getSkillCommandName(folder),
              name: skillConfig.name,
              description: skillConfig.description,
              iconName: skillConfig.icon_name,
              version: skillConfig.version,
              format: SkillFormat.LeonNative,
              path: skillPath
            })
          } catch {
            continue
          }

          continue
        }
      }
    }

    for (const skillsPath of this.getAgentSkillRootPaths()) {
      if (!fs.existsSync(skillsPath)) {
        continue
      }

      for (const folder of fs.readdirSync(skillsPath)) {
        const skillPath = path.join(skillsPath, folder)

        if (!fs.statSync(skillPath).isDirectory()) {
          continue
        }

        const frontmatter = this.getAgentSkillFrontmatterFromPath(skillPath)

        if (!frontmatter) {
          continue
        }

        descriptors.set(frontmatter.name, {
          id: frontmatter.name,
          commandName: frontmatter.name,
          name: frontmatter.name,
          description: frontmatter.description,
          iconName: AGENT_SKILL_ICON_NAME,
          version: AGENT_SKILL_VERSION,
          format: SkillFormat.AgentSkill,
          path: skillPath
        })
      }
    }

    return [...descriptors.values()].sort((firstDescriptor, secondDescriptor) =>
      firstDescriptor.commandName.localeCompare(secondDescriptor.commandName)
    )
  }

  /**
   * List only skills installed in the active profile.
   */
  public static listProfileSkillDescriptorsSync(): SkillDescriptor[] {
    const descriptors = new Map<string, SkillDescriptor>()

    if (fs.existsSync(PROFILE_NATIVE_SKILLS_PATH)) {
      for (const folder of fs.readdirSync(PROFILE_NATIVE_SKILLS_PATH)) {
        const skillPath = path.join(PROFILE_NATIVE_SKILLS_PATH, folder)

        if (!fs.statSync(skillPath).isDirectory()) {
          continue
        }

        const skillConfigPath = path.join(skillPath, SKILL_CONFIG_FILENAME)
        if (!fs.existsSync(skillConfigPath)) {
          continue
        }

        try {
          const skillConfig = JSON.parse(
            fs.readFileSync(skillConfigPath, 'utf8')
          ) as SkillSchema

          descriptors.set(folder, {
            id: folder,
            commandName: this.getSkillCommandName(folder),
            name: skillConfig.name,
            description: skillConfig.description,
            iconName: skillConfig.icon_name,
            version: skillConfig.version,
            format: SkillFormat.LeonNative,
            path: skillPath
          })
        } catch {
          continue
        }
      }
    }

    if (fs.existsSync(PROFILE_AGENT_SKILLS_PATH)) {
      for (const folder of fs.readdirSync(PROFILE_AGENT_SKILLS_PATH)) {
        const skillPath = path.join(PROFILE_AGENT_SKILLS_PATH, folder)

        if (!fs.statSync(skillPath).isDirectory()) {
          continue
        }

        const frontmatter = this.getAgentSkillFrontmatterFromPath(skillPath)

        if (!frontmatter) {
          continue
        }

        descriptors.set(frontmatter.name, {
          id: frontmatter.name,
          commandName: frontmatter.name,
          name: frontmatter.name,
          description: frontmatter.description,
          iconName: AGENT_SKILL_ICON_NAME,
          version: AGENT_SKILL_VERSION,
          format: SkillFormat.AgentSkill,
          path: skillPath
        })
      }
    }

    return [...descriptors.values()].sort((firstDescriptor, secondDescriptor) =>
      firstDescriptor.commandName.localeCompare(secondDescriptor.commandName)
    )
  }

  /**
   * Remove a skill installed in the active profile.
   */
  public static async removeProfileSkill(
    skillId: string
  ): Promise<SkillDescriptor | null> {
    const descriptor =
      this.listProfileSkillDescriptorsSync().find(
        (profileSkillDescriptor) => profileSkillDescriptor.id === skillId
      ) || null

    if (!descriptor) {
      return null
    }

    const profileSkillRootPath =
      descriptor.format === SkillFormat.LeonNative
        ? PROFILE_NATIVE_SKILLS_PATH
        : PROFILE_AGENT_SKILLS_PATH

    if (!this.isSafeProfileSkillPath(descriptor.path, profileSkillRootPath)) {
      throw new Error(
        `Refusing to remove skill outside the active profile: ${descriptor.path}`
      )
    }

    await fs.promises.rm(descriptor.path, {
      recursive: true,
      force: false
    })

    return descriptor
  }

  /**
   * List enabled native and Agent Skill descriptors.
   */
  public static listSkillDescriptorsSync(): SkillDescriptor[] {
    return this.listAllSkillDescriptorsSync().filter(
      (descriptor) => !ProfileHelper.isSkillDisabled(descriptor.id)
    )
  }

  private static isSafeProfileSkillPath(
    candidatePath: string,
    profileSkillRootPath: string
  ): boolean {
    try {
      const realCandidatePath = fs.realpathSync(candidatePath)
      const realProfileSkillRootPath = fs.realpathSync(profileSkillRootPath)
      const relativePath = path.relative(
        realProfileSkillRootPath,
        realCandidatePath
      )

      return (
        relativePath.length > 0 &&
        !relativePath.startsWith('..') &&
        !path.isAbsolute(relativePath)
      )
    } catch {
      return false
    }
  }

  /**
   * Resolve a skill descriptor by canonical ID.
   * @param skillId Native skill folder name or Agent Skill frontmatter name
   */
  public static getSkillDescriptorSync(
    skillId: string,
    options?: SkillLookupOptions
  ): SkillDescriptor | null {
    const descriptors = options?.includeDisabled
      ? this.listAllSkillDescriptorsSync()
      : this.listSkillDescriptorsSync()

    return descriptors.find((descriptor) => descriptor.id === skillId) || null
  }

  /**
   * List enabled Agent Skill discovery metadata for the agent loop.
   */
  public static listAgentSkillFriendlyPromptsSync(): string[] {
    return this.listSkillDescriptorsSync()
      .filter((descriptor) => descriptor.format === SkillFormat.AgentSkill)
      .map(
        (descriptor) =>
          `${descriptor.id}: ${descriptor.description} (SKILL.md: ${path.join(
            descriptor.path,
            AGENT_SKILL_FILENAME
          )})`
      )
      .sort()
  }

  /**
   * Build Agent Skill discovery metadata for agent prompts.
   */
  public static getAgentSkillCatalogContentSync(): string {
    const friendlyPrompts = this.listAgentSkillFriendlyPromptsSync()

    if (friendlyPrompts.length === 0) {
      return 'No Agent Skills are installed.'
    }

    return friendlyPrompts
      .map((friendlyPrompt, index) => `${index + 1}. ${friendlyPrompt}`)
      .join('\n')
  }

  /**
   * Load the full Agent Skill instructions for execution.
   * @param skillId Agent Skill frontmatter name
   */
  public static async getAgentSkillExecutionContext(
    skillId: string
  ): Promise<AgentSkillExecutionContext | null> {
    const descriptor = this.getSkillDescriptorSync(skillId)

    if (!descriptor || descriptor.format !== SkillFormat.AgentSkill) {
      return null
    }

    const skillPath = path.join(descriptor.path, AGENT_SKILL_FILENAME)
    const instructions = (await fs.promises.readFile(skillPath, 'utf8')).trim()

    if (!instructions) {
      return null
    }

    return {
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
      rootPath: descriptor.path,
      skillPath,
      instructions
    }
  }

  /**
   * TODO: rename this function when legacy getSkillConfig is removed
   *
   * Get skill configuration (skill.json)
   * @param skillName Skill name to get configuration for
   */
  public static async getNewSkillConfig(
    skillName: SkillSchema['name'],
    options?: SkillLookupOptions
  ): Promise<SkillSchema | null> {
    const skillConfigPath = SkillDomainHelper.getNewSkillConfigPath(
      skillName,
      options
    )

    if (!skillConfigPath) {
      return null
    }

    return JSON.parse(
      await fs.promises.readFile(skillConfigPath, 'utf8')
    ) as SkillSchema
  }

  public static getNewSkillConfigSync(
    skillName: SkillSchema['name'],
    options?: SkillLookupOptions
  ): SkillSchema | null {
    const skillConfigPath = SkillDomainHelper.getNewSkillConfigPath(
      skillName,
      options
    )

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
    skillName: SkillSchema['name'],
    options?: SkillLookupOptions
  ): string | null {
    const skillPath = this.resolveSkillPath(skillName, options)

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
  public static resolveSkillPath(
    skillName: SkillSchema['name'],
    options?: SkillLookupOptions
  ): string | null {
    if (!options?.includeDisabled && ProfileHelper.isSkillDisabled(skillName)) {
      return null
    }

    for (const skillsPath of this.getProfileFirstNativeSkillRootPaths()) {
      const skillPath = path.join(skillsPath, skillName)
      const skillConfigPath = path.join(skillPath, 'skill.json')

      if (fs.existsSync(skillConfigPath)) {
        return skillPath
      }
    }

    return null
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
      path.join(
        PROFILE_NATIVE_SKILLS_PATH,
        normalizedSkillName,
        'memory',
        `${memory}.json`
      )
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
