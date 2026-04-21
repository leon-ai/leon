import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_DOT_ENV_PATH } from '@/constants'

import { createSetupStatus } from './setup-status'

const DOT_ENV_PATH = PROFILE_DOT_ENV_PATH
const DOT_ENV_SAMPLE_PATH = path.join(process.cwd(), '.env.sample')
const ENV_LINE_SEPARATOR_PATTERN = /\r?\n/

function splitEnvLines(content) {
  return content.split(ENV_LINE_SEPARATOR_PATTERN)
}

function getEnvVariableName(line) {
  const trimmedLine = line.trim()

  if (
    trimmedLine === '' ||
    trimmedLine.startsWith('#') ||
    !trimmedLine.includes('=')
  ) {
    return null
  }

  const variableName = trimmedLine.slice(0, trimmedLine.indexOf('=')).trim()

  return /^[A-Z0-9_]+$/.test(variableName) ? variableName : null
}

async function mergeMissingEnvVariables() {
  const sampleContent = await fs.promises.readFile(DOT_ENV_SAMPLE_PATH, 'utf8')
  const dotEnvContent = await fs.promises.readFile(DOT_ENV_PATH, 'utf8')
  const dotEnvLines = splitEnvLines(dotEnvContent)
  const existingVariableNames = new Set(
    dotEnvLines
      .map((line) => getEnvVariableName(line))
      .filter((variableName) => variableName !== null)
  )
  const missingSampleLines = sampleContent
    .split(ENV_LINE_SEPARATOR_PATTERN)
    .filter((line) => {
      const variableName = getEnvVariableName(line)

      return variableName !== null && !existingVariableNames.has(variableName)
    })

  if (missingSampleLines.length === 0) {
    return '.env: up-to-date'
  }

  const normalizedDotEnvContent = dotEnvContent.endsWith('\n')
    ? dotEnvContent
    : `${dotEnvContent}\n`
  const separator = normalizedDotEnvContent.trim() === '' ? '' : '\n'
  const mergedContent = `${normalizedDotEnvContent}${separator}${missingSampleLines.join('\n')}\n`

  await fs.promises.writeFile(DOT_ENV_PATH, mergedContent)

  return `.env: +${missingSampleLines.length} variable${
    missingSampleLines.length > 1 ? 's' : ''
  }`
}

/**
 * Read selected variables from `.env` without mutating process.env.
 */
export async function readDotEnvVariables(variableNames) {
  if (!fs.existsSync(DOT_ENV_PATH)) {
    return {}
  }

  const dotEnvContent = await fs.promises.readFile(DOT_ENV_PATH, 'utf8')
  const values = {}

  for (const line of splitEnvLines(dotEnvContent)) {
    const variableName = getEnvVariableName(line)

    if (!variableName || !variableNames.includes(variableName)) {
      continue
    }

    values[variableName] = line.slice(line.indexOf('=') + 1).replace(/\r$/, '')
  }

  return values
}

/**
 * Upsert a single variable inside `.env`.
 */
export async function updateDotEnvVariable(variableName, value) {
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

/**
 * Duplicate the .env.sample to .env file
 */
export default async () => {
  const status = createSetupStatus('Preparing .env...').start()

  if (!fs.existsSync(DOT_ENV_PATH)) {
    await fs.promises.mkdir(path.dirname(DOT_ENV_PATH), { recursive: true })
    await fs.promises.copyFile(DOT_ENV_SAMPLE_PATH, DOT_ENV_PATH)
    status.succeed('.env: created')

    return
  }

  status.succeed(await mergeMissingEnvVariables())
}
