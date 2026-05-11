import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_DISABLED_PATH } from '@/constants'
import { PROFILE_DOT_ENV_PATH } from '@/leon-roots'

interface ProfileDisabledConfig {
  skills?: string[]
  tools?: string[]
}

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

function readDisabledConfig(): ProfileDisabledConfig {
  if (!fs.existsSync(PROFILE_DISABLED_PATH)) {
    return {}
  }

  try {
    return JSON.parse(
      fs.readFileSync(PROFILE_DISABLED_PATH, 'utf8')
    ) as ProfileDisabledConfig
  } catch {
    return {}
  }
}

async function writeDisabledConfig(config: ProfileDisabledConfig): Promise<void> {
  await fs.promises.mkdir(path.dirname(PROFILE_DISABLED_PATH), {
    recursive: true
  })

  await fs.promises.writeFile(
    PROFILE_DISABLED_PATH,
    `${JSON.stringify(config, null, 2)}\n`
  )
}

function normalizeDisabledIds(ids: unknown): Set<string> {
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

function serializeDisabledIds(ids: Set<string>): string[] {
  return [...ids].sort((firstId, secondId) => firstId.localeCompare(secondId))
}

export class ProfileHelper {
  /**
   * Get disabled skill ids from the active profile.
   */
  public static getDisabledSkills(): Set<string> {
    return normalizeDisabledIds(readDisabledConfig().skills)
  }

  /**
   * Get disabled tool ids from the active profile.
   */
  public static getDisabledTools(): Set<string> {
    return normalizeDisabledIds(readDisabledConfig().tools)
  }

  /**
   * Check whether a skill is disabled in the active profile.
   * @param skillName The skill id
   */
  public static isSkillDisabled(skillName: string): boolean {
    return this.getDisabledSkills().has(skillName)
  }

  /**
   * Add a skill id to the active profile disabled skill list.
   * @param skillName The skill id
   */
  public static async disableSkill(skillName: string): Promise<void> {
    const disabledConfig = readDisabledConfig()
    const disabledSkills = normalizeDisabledIds(disabledConfig.skills)

    disabledSkills.add(skillName)

    await writeDisabledConfig({
      ...disabledConfig,
      skills: serializeDisabledIds(disabledSkills),
      tools: serializeDisabledIds(normalizeDisabledIds(disabledConfig.tools))
    })
  }

  /**
   * Remove a skill id from the active profile disabled skill list.
   * @param skillName The skill id
   */
  public static async enableSkill(skillName: string): Promise<void> {
    const disabledConfig = readDisabledConfig()
    const disabledSkills = normalizeDisabledIds(disabledConfig.skills)

    disabledSkills.delete(skillName)

    await writeDisabledConfig({
      ...disabledConfig,
      skills: serializeDisabledIds(disabledSkills),
      tools: serializeDisabledIds(normalizeDisabledIds(disabledConfig.tools))
    })
  }

  /**
   * Check whether a tool is disabled in the active profile.
   * @param toolId The tool id
   * @param toolkitId The optional toolkit id
   */
  public static isToolDisabled(toolId: string, toolkitId?: string): boolean {
    const disabledTools = this.getDisabledTools()

    if (disabledTools.has(toolId)) {
      return true
    }

    return toolkitId ? disabledTools.has(`${toolkitId}.${toolId}`) : false
  }

  /**
   * Add a tool id to the active profile disabled tool list.
   * @param toolId The qualified tool id
   */
  public static async disableTool(toolId: string): Promise<void> {
    const disabledConfig = readDisabledConfig()
    const disabledTools = normalizeDisabledIds(disabledConfig.tools)

    disabledTools.add(toolId)

    await writeDisabledConfig({
      ...disabledConfig,
      skills: serializeDisabledIds(normalizeDisabledIds(disabledConfig.skills)),
      tools: serializeDisabledIds(disabledTools)
    })
  }

  /**
   * Remove a tool id from the active profile disabled tool list.
   * @param toolId The qualified tool id
   */
  public static async enableTool(toolId: string): Promise<void> {
    const disabledConfig = readDisabledConfig()
    const disabledTools = normalizeDisabledIds(disabledConfig.tools)

    disabledTools.delete(toolId)

    await writeDisabledConfig({
      ...disabledConfig,
      skills: serializeDisabledIds(normalizeDisabledIds(disabledConfig.skills)),
      tools: serializeDisabledIds(disabledTools)
    })
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
