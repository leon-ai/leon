import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_DOT_ENV_PATH } from '@/leon-roots'

const DOT_ENV_PATH = PROFILE_DOT_ENV_PATH
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

export class DotEnvHelper {
  /**
   * Upsert a single variable inside `.env`.
   * @param variableName The environment variable name
   * @param value The environment variable value
   */
  public static async updateVariable(
    variableName: string,
    value: string
  ): Promise<void> {
    const dotEnvContent = fs.existsSync(DOT_ENV_PATH)
      ? await fs.promises.readFile(DOT_ENV_PATH, 'utf8')
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

    await fs.promises.mkdir(path.dirname(DOT_ENV_PATH), { recursive: true })

    await fs.promises.writeFile(
      DOT_ENV_PATH,
      `${normalizedLines.join('\n')}\n`
    )
  }
}
