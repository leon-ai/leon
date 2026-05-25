import fs from 'node:fs'
import path from 'node:path'

import { CONFIG_MANAGER } from '@/config'
import { PROFILE_DOT_ENV_PATH } from '@/leon-roots'

const ENV_LINE_SEPARATOR_PATTERN = /\r?\n/
const ENV_VARIABLE_NAME_PATTERN = /^[A-Z0-9_]+$/

function splitEnvLines(content: string): string[] {
  return content.split(ENV_LINE_SEPARATOR_PATTERN)
}

function getEnvVariableName(line: string): string | null {
  const trimmedLine = line.trim()

  if (
    trimmedLine === '' ||
    trimmedLine.startsWith('#') ||
    !trimmedLine.includes('=')
  ) {
    return null
  }

  const variableName = trimmedLine.slice(0, trimmedLine.indexOf('=')).trim()

  return ENV_VARIABLE_NAME_PATTERN.test(variableName) ? variableName : null
}

function normalizeAccessIds(ids: unknown): Set<string> {
  if (!Array.isArray(ids)) {
    return new Set()
  }

  return new Set(
    ids
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  )
}

function hasAccessList(ids: Set<string>): boolean {
  return ids.size > 0
}

function hasQualifiedOrBareToolId(
  toolIds: Set<string>,
  toolId: string,
  toolkitId?: string
): boolean {
  if (toolIds.has(toolId)) {
    return true
  }

  return toolkitId ? toolIds.has(`${toolkitId}.${toolId}`) : false
}

export class ProfileHelper {
  /**
   * Get disabled skill ids from the active profile.
   */
  public static getDisabledSkills(): Set<string> {
    return normalizeAccessIds(
      CONFIG_MANAGER.getConfig().availability.skills.disabled
    )
  }

  /**
   * Get disabled tool ids from the active profile.
   */
  public static getDisabledTools(): Set<string> {
    return normalizeAccessIds(
      CONFIG_MANAGER.getConfig().availability.tools.disabled
    )
  }

  /**
   * Get allowed skill ids from the active profile.
   */
  public static getAllowedSkills(): Set<string> {
    return normalizeAccessIds(
      CONFIG_MANAGER.getConfig().availability.skills.allowed
    )
  }

  /**
   * Get allowed tool ids from the active profile.
   */
  public static getAllowedTools(): Set<string> {
    return normalizeAccessIds(
      CONFIG_MANAGER.getConfig().availability.tools.allowed
    )
  }

  /**
   * Check whether the active profile restricts skill access with an allowlist.
   */
  public static hasSkillAllowlist(): boolean {
    return hasAccessList(this.getAllowedSkills())
  }

  /**
   * Check whether the active profile restricts tool access with an allowlist.
   */
  public static hasToolAllowlist(): boolean {
    return hasAccessList(this.getAllowedTools())
  }

  /**
   * Check whether a skill is allowed by the active profile allowlist.
   * @param skillName The skill id
   */
  public static isSkillAllowed(skillName: string): boolean {
    const allowedSkills = this.getAllowedSkills()

    return !hasAccessList(allowedSkills) || allowedSkills.has(skillName)
  }

  /**
   * Check whether a tool is allowed by the active profile allowlist.
   * @param toolId The tool id
   * @param toolkitId The optional toolkit id
   */
  public static isToolAllowed(toolId: string, toolkitId?: string): boolean {
    const allowedTools = this.getAllowedTools()

    return (
      !hasAccessList(allowedTools) ||
      hasQualifiedOrBareToolId(allowedTools, toolId, toolkitId)
    )
  }

  /**
   * Check whether a skill is explicitly disabled in the active profile.
   * @param skillName The skill id
   */
  public static isSkillExplicitlyDisabled(skillName: string): boolean {
    return this.getDisabledSkills().has(skillName)
  }

  /**
   * Check whether a tool is explicitly disabled in the active profile.
   * @param toolId The tool id
   * @param toolkitId The optional toolkit id
   */
  public static isToolExplicitlyDisabled(
    toolId: string,
    toolkitId?: string
  ): boolean {
    return hasQualifiedOrBareToolId(this.getDisabledTools(), toolId, toolkitId)
  }

  /**
   * Check whether a skill is disabled in the active profile.
   * @param skillName The skill id
   */
  public static isSkillDisabled(skillName: string): boolean {
    return this.hasSkillAllowlist()
      ? !this.isSkillAllowed(skillName)
      : this.isSkillExplicitlyDisabled(skillName)
  }

  /**
   * Add a skill id to the active profile disabled skill list.
   * @param skillName The skill id
   */
  public static async disableSkill(skillName: string): Promise<void> {
    const disabledSkills = this.getDisabledSkills()

    disabledSkills.add(skillName)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'skills', 'disabled'],
      disabledSkills
    )
  }

  /**
   * Remove a skill id from the active profile disabled skill list.
   * @param skillName The skill id
   */
  public static async enableSkill(skillName: string): Promise<void> {
    const disabledSkills = this.getDisabledSkills()

    disabledSkills.delete(skillName)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'skills', 'disabled'],
      disabledSkills
    )
  }

  /**
   * Add a skill id to the active profile allow-only skill list.
   * @param skillName The skill id
   */
  public static async allowOnlySkill(skillName: string): Promise<void> {
    const allowedSkills = this.getAllowedSkills()

    allowedSkills.add(skillName)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'skills', 'allowed'],
      allowedSkills
    )
  }

  /**
   * Remove a skill id from the active profile allow-only skill list.
   * @param skillName The skill id
   */
  public static async removeAllowOnlySkill(skillName: string): Promise<void> {
    const allowedSkills = this.getAllowedSkills()

    allowedSkills.delete(skillName)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'skills', 'allowed'],
      allowedSkills
    )
  }

  /**
   * Check whether a tool is disabled in the active profile.
   * @param toolId The tool id
   * @param toolkitId The optional toolkit id
   */
  public static isToolDisabled(toolId: string, toolkitId?: string): boolean {
    return this.hasToolAllowlist()
      ? !this.isToolAllowed(toolId, toolkitId)
      : this.isToolExplicitlyDisabled(toolId, toolkitId)
  }

  /**
   * Add a tool id to the active profile disabled tool list.
   * @param toolId The qualified tool id
   */
  public static async disableTool(toolId: string): Promise<void> {
    const disabledTools = this.getDisabledTools()

    disabledTools.add(toolId)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'tools', 'disabled'],
      disabledTools
    )
  }

  /**
   * Remove a tool id from the active profile disabled tool list.
   * @param toolId The qualified tool id
   */
  public static async enableTool(toolId: string): Promise<void> {
    const disabledTools = this.getDisabledTools()

    disabledTools.delete(toolId)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'tools', 'disabled'],
      disabledTools
    )
  }

  /**
   * Add a tool id to the active profile allow-only tool list.
   * @param toolId The qualified tool id
   */
  public static async allowOnlyTool(toolId: string): Promise<void> {
    const allowedTools = this.getAllowedTools()

    allowedTools.add(toolId)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'tools', 'allowed'],
      allowedTools
    )
  }

  /**
   * Remove a tool id from the active profile allow-only tool list.
   * @param toolId The qualified tool id
   */
  public static async removeAllowOnlyTool(toolId: string): Promise<void> {
    const allowedTools = this.getAllowedTools()

    allowedTools.delete(toolId)

    await CONFIG_MANAGER.setStringList(
      ['availability', 'tools', 'allowed'],
      allowedTools
    )
  }

  /**
   * Upsert a single variable inside the profile `.env`.
   * @param variableName The environment variable name
   * @param value The environment variable value
   */
  public static async updateDotEnvVariable(
    variableName: string,
    value: string
  ): Promise<void> {
    const dotEnvContent = fs.existsSync(PROFILE_DOT_ENV_PATH)
      ? await fs.promises.readFile(PROFILE_DOT_ENV_PATH, 'utf8')
      : ''
    const dotEnvLines = dotEnvContent === '' ? [] : splitEnvLines(dotEnvContent)
    const nextLine = `${variableName}=${value}`
    let hasUpdatedLine = false

    const updatedLines = dotEnvLines.map((line) => {
      if (getEnvVariableName(line) !== variableName) {
        return line
      }

      hasUpdatedLine = true

      return nextLine
    })

    if (!hasUpdatedLine) {
      updatedLines.push(nextLine)
    }

    const normalizedLines = updatedLines.filter(
      (line, index, lines) => !(index === lines.length - 1 && line === '')
    )

    await fs.promises.mkdir(path.dirname(PROFILE_DOT_ENV_PATH), {
      recursive: true
    })

    await fs.promises.writeFile(
      PROFILE_DOT_ENV_PATH,
      `${normalizedLines.join('\n')}\n`
    )
  }
}
