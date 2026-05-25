import fs from 'node:fs'
import path from 'node:path'

import YAML, { isMap } from 'yaml'

import {
  LEON_PROFILE_PATH,
  PROFILE_CONFIG_PATH,
  PROFILE_DOT_ENV_PATH
} from '@/leon-roots'

import { createSetupStatus } from './setup-status'

const CONFIG_PATH = PROFILE_CONFIG_PATH
const CONFIG_SAMPLE_PATH = path.join(process.cwd(), 'config.sample.yml')
const CONFIG_SCHEMA_PATH = path.join(
  process.cwd(),
  'schemas',
  'core-schemas',
  'config.json'
)
const PROFILE_CONFIG_SCHEMA_PATH = path.join(
  LEON_PROFILE_PATH,
  'schemas',
  'core-schemas',
  'config.json'
)
const LEGACY_DISABLED_PATH = path.join(LEON_PROFILE_PATH, 'disabled.json')
const LEGACY_ALLOWED_PATH = path.join(LEON_PROFILE_PATH, 'allowed.json')
const YAML_SCHEMA_COMMENT_PATTERN =
  /^# yaml-language-server: \$schema=.*(?:\r?\n)?/
const PROFILE_YAML_SCHEMA_REFERENCE = './schemas/core-schemas/config.json'
const ENV_LINE_SEPARATOR_PATTERN = /\r?\n/
const OPTIONAL_STRING_CONFIG_PATHS = [
  ['llm', 'default'],
  ['llm', 'workflow'],
  ['llm', 'agent'],
  ['time_zone']
]

function getPairKey(pair) {
  return String(pair.key?.value || pair.key || '').trim()
}

function findPair(map, key) {
  return map.items.find((pair) => getPairKey(pair) === key) || null
}

function mergeMissingMapPairs(targetMap, sampleMap, schema) {
  let addedCount = 0

  for (const samplePair of sampleMap.items) {
    const key = getPairKey(samplePair)
    if (!key) {
      continue
    }

    const targetPair = findPair(targetMap, key)
    if (!targetPair) {
      targetMap.items.push(samplePair.clone(schema))
      addedCount += 1
      continue
    }

    if (isMap(targetPair.value) && isMap(samplePair.value)) {
      addedCount += mergeMissingMapPairs(
        targetPair.value,
        samplePair.value,
        schema
      )
    }
  }

  return addedCount
}

function withProfileSchemaReference(content) {
  const schemaComment = `# yaml-language-server: $schema=${PROFILE_YAML_SCHEMA_REFERENCE}\n`

  if (YAML_SCHEMA_COMMENT_PATTERN.test(content)) {
    return content.replace(YAML_SCHEMA_COMMENT_PATTERN, schemaComment)
  }

  return `${schemaComment}${content}`
}

async function syncProfileConfigSchema() {
  if (!fs.existsSync(CONFIG_SCHEMA_PATH)) {
    return
  }

  await fs.promises.mkdir(path.dirname(PROFILE_CONFIG_SCHEMA_PATH), {
    recursive: true
  })
  await fs.promises.copyFile(CONFIG_SCHEMA_PATH, PROFILE_CONFIG_SCHEMA_PATH)
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

async function readLegacyDotEnvVariables() {
  if (!fs.existsSync(PROFILE_DOT_ENV_PATH)) {
    return {}
  }

  const dotEnvContent = await fs.promises.readFile(PROFILE_DOT_ENV_PATH, 'utf8')
  const values = {}

  for (const line of dotEnvContent.split(ENV_LINE_SEPARATOR_PATTERN)) {
    const variableName = getEnvVariableName(line)

    if (!variableName) {
      continue
    }

    values[variableName] = line.slice(line.indexOf('=') + 1).replace(/\r$/, '')
  }

  return values
}

function toBoolean(value) {
  const normalizedValue = String(value || '').trim().toLowerCase()

  if (normalizedValue === 'true') {
    return true
  }

  if (normalizedValue === 'false') {
    return false
  }

  return null
}

function toPort(value) {
  const port = Number(value)

  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null
}

function toContextFileList(value) {
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function toOptionalString(value) {
  const normalizedValue = String(value || '').trim()

  return normalizedValue === '' ? null : normalizedValue
}

function toRoutingMode(value) {
  const normalizedValue = String(value || '').trim()

  return normalizedValue === 'workflow' ? 'controlled' : normalizedValue
}

function isEmptyList(value) {
  return !Array.isArray(value) || value.length === 0
}

function readLegacyAccessConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      skills: [],
      tools: []
    }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    return {
      skills: Array.isArray(parsed?.skills) ? parsed.skills : [],
      tools: Array.isArray(parsed?.tools) ? parsed.tools : []
    }
  } catch {
    return {
      skills: [],
      tools: []
    }
  }
}

function normalizeAccessList(values) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  )].sort((firstValue, secondValue) => firstValue.localeCompare(secondValue))
}

function setDocumentValue(document, keyPath, value, shouldOverwrite) {
  if (!shouldOverwrite && document.getIn(keyPath) !== undefined) {
    return false
  }

  document.setIn(keyPath, value)

  return true
}

function normalizeOptionalStringValues(document) {
  let normalizedCount = 0

  for (const keyPath of OPTIONAL_STRING_CONFIG_PATHS) {
    const value = document.getIn(keyPath)

    if (typeof value !== 'string' || value.trim() !== '') {
      continue
    }

    document.setIn(keyPath, null)
    normalizedCount += 1
  }

  return normalizedCount
}

async function migrateLegacyConfigValues(document, shouldOverwriteScalarValues) {
  let migrationCount = 0
  const envValues = await readLegacyDotEnvVariables()
  const mappings = [
    ['LEON_LANG', ['language'], (value) => value.trim()],
    ['LEON_HOST', ['server', 'host'], (value) => value.trim()],
    ['LEON_PORT', ['server', 'port'], toPort],
    ['LEON_ROUTING_MODE', ['routing', 'mode'], toRoutingMode],
    ['LEON_MOOD', ['mood', 'mode'], (value) => value.trim()],
    ['LEON_LLM', ['llm', 'default'], toOptionalString],
    ['LEON_WORKFLOW_LLM', ['llm', 'workflow'], toOptionalString],
    ['LEON_AGENT_LLM', ['llm', 'agent'], toOptionalString],
    [
      'LEON_LLAMACPP_BASE_URL',
      ['llm', 'providers', 'llamacpp', 'base_url'],
      (value) => value.trim()
    ],
    [
      'LEON_SGLANG_BASE_URL',
      ['llm', 'providers', 'sglang', 'base_url'],
      (value) => value.trim()
    ],
    ['LEON_WAKE_WORD', ['voice', 'wake_word_enabled'], toBoolean],
    ['LEON_ASR', ['voice', 'asr', 'enabled'], toBoolean],
    ['LEON_ASR_PROVIDER', ['voice', 'asr', 'provider'], (value) => value.trim()],
    ['LEON_TTS', ['voice', 'tts', 'enabled'], toBoolean],
    ['LEON_TTS_PROVIDER', ['voice', 'tts', 'provider'], (value) => value.trim()],
    ['LEON_TIME_ZONE', ['time_zone'], toOptionalString],
    ['LEON_AFTER_SPEECH', ['after_speech_enabled'], toBoolean],
    ['LEON_OVER_HTTP', ['http', 'enabled'], toBoolean],
    ['LEON_HTTP_API_LANG', ['http', 'lang'], (value) => value.trim()],
    ['LEON_TELEMETRY', ['telemetry_enabled'], toBoolean],
    [
      'LEON_PY_TCP_SERVER_HOST',
      ['python_tcp_server', 'host'],
      (value) => value.trim()
    ],
    ['LEON_PY_TCP_SERVER_PORT', ['python_tcp_server', 'port'], toPort],
    ['LEON_DISABLED_CONTEXT_FILES', ['context', 'disabled_files'], toContextFileList]
  ]

  for (const [envName, keyPath, normalizeValue] of mappings) {
    if (!Object.hasOwn(envValues, envName)) {
      continue
    }

    const normalizedValue = normalizeValue(envValues[envName])
    if (
      normalizedValue === null ||
      normalizedValue === undefined ||
      (typeof normalizedValue === 'string' && normalizedValue === '')
    ) {
      continue
    }

    if (setDocumentValue(
      document,
      keyPath,
      normalizedValue,
      shouldOverwriteScalarValues
    )) {
      migrationCount += 1
    }
  }

  const legacyAllowed = readLegacyAccessConfig(LEGACY_ALLOWED_PATH)
  const legacyDisabled = readLegacyAccessConfig(LEGACY_DISABLED_PATH)
  const accessMigrations = [
    [
      ['availability', 'skills', 'allowed'],
      normalizeAccessList(legacyAllowed.skills)
    ],
    [
      ['availability', 'tools', 'allowed'],
      normalizeAccessList(legacyAllowed.tools)
    ],
    [
      ['availability', 'skills', 'disabled'],
      normalizeAccessList(legacyDisabled.skills)
    ],
    [
      ['availability', 'tools', 'disabled'],
      normalizeAccessList(legacyDisabled.tools)
    ]
  ]

  for (const [keyPath, values] of accessMigrations) {
    if (values.length === 0 || !isEmptyList(document.getIn(keyPath))) {
      continue
    }

    document.setIn(keyPath, values)
    migrationCount += 1
  }

  return migrationCount + normalizeOptionalStringValues(document)
}

async function mergeMissingConfigKeys() {
  const sampleContent = await fs.promises.readFile(CONFIG_SAMPLE_PATH, 'utf8')
  const configContent = await fs.promises.readFile(CONFIG_PATH, 'utf8')
  const sampleDocument = YAML.parseDocument(sampleContent)
  const configDocument = YAML.parseDocument(configContent)

  if (!isMap(sampleDocument.contents) || !isMap(configDocument.contents)) {
    return 'config.yml: skipped invalid YAML document'
  }

  const migrationCount = await migrateLegacyConfigValues(configDocument, false)
  const addedCount = mergeMissingMapPairs(
    configDocument.contents,
    sampleDocument.contents,
    configDocument.schema
  )

  if (addedCount === 0 && migrationCount === 0) {
    return 'config.yml: up-to-date'
  }

  await fs.promises.writeFile(
    CONFIG_PATH,
    withProfileSchemaReference(String(configDocument))
  )

  return `config.yml: +${addedCount + migrationCount} setting${
    addedCount + migrationCount > 1 ? 's' : ''
  }`
}

/**
 * Create or merge the profile config.yml file.
 */
export default async () => {
  const status = createSetupStatus('Preparing config.yml...').start()

  await syncProfileConfigSchema()

  if (!fs.existsSync(CONFIG_PATH)) {
    await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
    const sampleContent = await fs.promises.readFile(CONFIG_SAMPLE_PATH, 'utf8')
    const configDocument = YAML.parseDocument(
      withProfileSchemaReference(sampleContent)
    )
    await migrateLegacyConfigValues(configDocument, true)
    await fs.promises.writeFile(
      CONFIG_PATH,
      withProfileSchemaReference(String(configDocument))
    )
    status.succeed('config.yml: created')

    return
  }

  status.succeed(await mergeMissingConfigKeys())
}
