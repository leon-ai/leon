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
   * Check whether a tool is disabled in the active profile.
   * @param toolId The tool id
   */
  public static isToolDisabled(toolId: string): boolean {
    return this.getDisabledTools().has(toolId)
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
