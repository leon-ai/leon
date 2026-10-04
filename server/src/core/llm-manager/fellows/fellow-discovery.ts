import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import execa from 'execa'
import { parseJSON5 } from 'confbox/json5'
import { parseTOML } from 'confbox/toml'
import { parse as parseYAML } from 'yaml'
import { parse as parseDotenv } from 'dotenv'
import Database from 'better-sqlite3'

import {
  FELLOWS,
  getFellowDirectory,
  getFellowEnvironment,
  isClaudeSubscriptionAvailable,
  type FellowEnvironment,
  type FellowDefinition
} from './fellow-catalog'
import { getLLMModelCatalogEntries, getLLMModelCatalogProviders } from '../llm-model-catalog'
import { LLMProviders } from '../types'
import {
  LLM_PROVIDER_ACCOUNT_CONFIGS,
  getRequiredLLMProviderAccountConfig
} from '@/core/llm-manager/llm-provider-account-configs'

const MAX_CONFIG_BYTES = 1_048_576
const CLI_STATUS_TIMEOUT_MS = 5_000
const CLAUDE_OAUTH_TOKEN_PREFIX = 'sk-ant-oat'
const MAX_REFERENCED_DIRECTORIES = 32
const ENV_PROVIDERS: Record<string, LLMProviders> = Object.fromEntries(
  LLM_PROVIDER_ACCOUNT_CONFIGS.flatMap((config) =>
    (config.fellowAPIKeyEnvs || []).map((name) => [name, config.value])
  )
)
const KEY_REFERENCE_PREFIXES = ['{env:', '${']
const CONFIG_DIRECTORY_FIELDS = new Set([
  'claudeConfigDir', 'configDir', 'configDirectory', 'configDirPath',
  'CLAUDE_CONFIG_DIR', 'claudeConfigDirectory'
])
const credentialReaders = new WeakMap<FellowConnection, () => Promise<string>>()

export enum FellowAuthType {
  APIKey = 'api_key',
  ChatGPT = 'chatgpt',
  ClaudeCode = 'claude_code'
}

export interface FellowConnection {
  id: string
  provider: LLMProviders
  authType: FellowAuthType
  model: string
  sources: string[]
  baseURL?: string
  configDirectory?: string
}

export interface FellowDiscovery {
  fellows: string[]
  connections: FellowConnection[]
  issues: string[]
}

type ConfigRecord = Record<string, unknown>

function record(value: unknown): ConfigRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ConfigRecord
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function provider(value: string): LLMProviders | undefined {
  const normalized = value.toLowerCase()

  return LLM_PROVIDER_ACCOUNT_CONFIGS.find((config) =>
    config.aliases?.includes(normalized)
  )?.value ||
    Object.values(LLMProviders).find((candidate) => candidate === normalized)
}

function modelFor(selectedProvider: LLMProviders, configured: string): string {
  const prefix = `${selectedProvider}/`
  const model = configured.startsWith(prefix)
    ? configured.slice(prefix.length)
    : configured

  if (model) {
    return model
  }

  const entries = getLLMModelCatalogEntries(selectedProvider)

  return (entries.find((entry) => entry.recommended) || entries[0])?.model || ''
}

async function readConfig(file: string, format: string): Promise<ConfigRecord> {
  const stat = await fs.stat(file)

  if (stat.size > MAX_CONFIG_BYTES || !stat.isFile()) {
    throw new Error('Configuration is too large or is not a file.')
  }

  const content = await fs.readFile(file, 'utf8')

  if (format === 'toml') {
    return record(parseTOML(content))
  }

  if (format === 'yaml') {
    return record(parseYAML(content))
  }

  if (format === 'dotenv') {
    return parseDotenv(content)
  }

  if (format === 'jsonc' || format === 'json5') {
    return record(parseJSON5(content))
  }

  return record(JSON.parse(content))
}

function endpointProvider(baseURL: string, fallback: LLMProviders): LLMProviders {
  // A fellow can route Claude/OpenAI-compatible requests to OpenRouter.
  try {
    const openRouterURL = getRequiredLLMProviderAccountConfig(LLMProviders.OpenRouter).baseURL
    if (new URL(baseURL).hostname === new URL(openRouterURL).hostname) {
      return LLMProviders.OpenRouter
    }
  } catch {
    // Missing endpoints use Leon's existing provider defaults.
  }

  return fallback
}

/**
 * Read a selected key privately; discoveries never serialize credential values.
 */
export async function readFellowAPIKey(connection: FellowConnection): Promise<string> {
  const reader = credentialReaders.get(connection)

  if (!reader) {
    throw new Error('Rediscover this fellow before connecting its API key.')
  }

  return reader()
}

function referencedClaudeDirectories(value: unknown, result: Set<string>): void {
  if (!value || typeof value !== 'object' || result.size >= MAX_REFERENCED_DIRECTORIES) {
    return
  }

  const settings = record(value)
  if (settings['driver'] === 'claude') {
    const homePath = string(record(settings['config'])['homePath'])
    if (homePath) {
      result.add(homePath)
    }
  }
  if (CONFIG_DIRECTORY_FIELDS.has(string(settings['name'])) && string(settings['value'])) {
    result.add(string(settings['value']))
  }

  for (const [key, child] of Object.entries(value)) {
    if (CONFIG_DIRECTORY_FIELDS.has(key) && string(child)) {
      result.add(string(child))
    } else {
      referencedClaudeDirectories(child, result)
    }
  }
}

/**
 * Inspect known fellow stores only. This never links accounts, writes files,
 * runs configured key-helper commands, or makes inference requests.
 */
export async function discoverFellows(
  environment: FellowEnvironment = getFellowEnvironment()
): Promise<FellowDiscovery> {
  const result: FellowDiscovery = { fellows: [], connections: [], issues: [] }
  const deduplicated = new Map<string, FellowConnection>()
  const claudeDirectories = new Set<string>()
  const order = getLLMModelCatalogProviders()

  const add = (
    fellow: FellowDefinition,
    selectedProvider: LLMProviders,
    authType: FellowAuthType,
    configuredModel: string,
    key = '',
    baseURL = '',
    configDirectory = ''
  ): void => {
    const actualProvider = endpointProvider(baseURL, selectedProvider)
    if (actualProvider === LLMProviders.OpenRouter && selectedProvider !== actualProvider) {
      baseURL = getRequiredLLMProviderAccountConfig(LLMProviders.OpenRouter).baseURL
      if (!configuredModel.includes('/')) {
        configuredModel = ''
      }
    }
    if (actualProvider === LLMProviders.Anthropic && authType === FellowAuthType.APIKey &&
      key.startsWith(CLAUDE_OAUTH_TOKEN_PREFIX)) {
      // Subscription tokens are not API keys or evidence of a Claude Code login.
      return
    }
    const identity = createHash('sha256')
      .update(JSON.stringify([actualProvider, authType, key || configDirectory, baseURL]))
      .digest('hex')
    const existing = deduplicated.get(identity)

    if (existing) {
      if (!existing.sources.includes(fellow.label)) {
        existing.sources.push(fellow.label)
      }
      return
    }

    const connection: FellowConnection = {
      id: createHash('sha256')
        .update(JSON.stringify([actualProvider, authType, fellow.id, configDirectory, result.connections.length]))
        .digest('hex').slice(0, 12),
      provider: actualProvider,
      authType,
      model: modelFor(actualProvider, configuredModel),
      sources: [fellow.label],
      ...(baseURL ? { baseURL } : {}),
      ...(configDirectory ? { configDirectory } : {})
    }

    if (authType === FellowAuthType.APIKey) {
      // Configured command-based secrets remain unresolved; never execute them.
      if (!key || key.startsWith('!') || !connection.model) {
        return
      }
      credentialReaders.set(connection, async () => key)
    }

    deduplicated.set(identity, connection)
    result.connections.push(connection)
  }

  const inspect = async (fellow: FellowDefinition, directory: string): Promise<void> => {
    const configs: ConfigRecord[] = []
    let found = false
    const files = [...fellow.files]

    for (const entry of fellow.configFiles || []) {
      const configDirectory = getFellowDirectory(fellow, environment, true)
      files.push([path.join(configDirectory, entry[0]!), entry[1]!])
    }

    if (fellow.id === 'opencode' && environment.env['OPENCODE_CONFIG']) {
      files.push([environment.env['OPENCODE_CONFIG'], 'jsonc'])
    }

    if (fellow.id === 'openclaw' && environment.env['OPENCLAW_CONFIG_PATH']) {
      files.push([environment.env['OPENCLAW_CONFIG_PATH'], 'jsonc'])
    }

    for (const [filename, format] of files) {
      const file = path.isAbsolute(filename!) ? filename! : path.join(directory, filename!)

      try {
        configs.push(await readConfig(file, format!))
        found = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          result.issues.push(`${fellow.label}: I could not read one of its settings files.`)
        }
      }
    }

    if (!found) {
      found = await fs.stat(directory).then((stat) => stat.isDirectory()).catch(() => false)
    }
    if (!found) {
      return
    }
    if (!result.fellows.includes(fellow.label)) {
      result.fellows.push(fellow.label)
    }

    const settings = Object.assign({}, ...configs) as ConfigRecord
    const modelSettings = record(settings['model'])
    const agentModel = record(record(settings['agents'])['defaults'])['model']
    const configuredModel = string(settings['model']) || string(modelSettings['default']) ||
      string(settings['defaultModel']) || string(agentModel) || string(record(agentModel)['primary'])
    const configuredProvider = provider(string(settings['defaultProvider']) ||
      string(modelSettings['provider']) || string(settings['model_provider']) ||
      configuredModel.split('/')[0] || '') ||
      (fellow.id === 'codex' ? LLMProviders.OpenAI :
        fellow.id === 'claude-code' ? LLMProviders.Anthropic : undefined)
    const configuredFor = (selectedProvider: LLMProviders): string => {
      if (configuredProvider && selectedProvider !== configuredProvider) {
        return ''
      }
      // A key for another service must not inherit the fellow's selected model.
      if (!configuredProvider && !getLLMModelCatalogEntries(selectedProvider)
        .some((entry) => entry.model === configuredModel)) {
        return ''
      }
      return configuredModel
    }
    const env = { ...record(settings['env']), ...settings }
    const endpointFor = (selectedProvider: LLMProviders): string => {
      const named = selectedProvider === LLMProviders.Anthropic
        ? string(env['ANTHROPIC_BASE_URL']) : selectedProvider === LLMProviders.OpenAI
          ? string(env['OPENAI_BASE_URL']) : ''
      return named || (selectedProvider === configuredProvider
        ? string(settings['base_url']) || string(settings['baseUrl']) || string(modelSettings['base_url']) : '')
    }

    for (const [name, selectedProvider] of Object.entries(ENV_PROVIDERS)) {
      const key = string(env[name])

      if (key) {
        add(fellow, selectedProvider, FellowAuthType.APIKey, configuredFor(selectedProvider),
          key, endpointFor(selectedProvider), directory)
      }
    }

    const resolveKey = (value: unknown): string => {
      const key = string(value)
      if (key.startsWith('!')) {
        return ''
      }
      const prefix = KEY_REFERENCE_PREFIXES.find((candidate) => key.startsWith(candidate))
      const name = prefix && key.endsWith('}') ? key.slice(prefix.length, -1) : key
      const resolved = string(env[name] || environment.env[name])
      return prefix || ENV_PROVIDERS[name] ? resolved : resolved || key
    }

    const inspectCredentials = (name: string, value: unknown): void => {
      const credential = record(value)
      const selectedProvider = provider(string(credential['provider']) || name)
      if (!selectedProvider) {
        return
      }
      const key = resolveKey(credential['key'] || credential['apiKey'] || credential['api_key'])
      const model = configuredFor(selectedProvider)

      if (credential['type'] === 'oauth' || credential['refresh'] || credential['refresh_token']) {
        if (selectedProvider === LLMProviders.OpenAI) {
          add(fellow, selectedProvider, FellowAuthType.ChatGPT, model, '', '', directory)
        }
      } else if (key) {
        add(fellow, selectedProvider, FellowAuthType.APIKey, model, key,
          string(credential['baseUrl']) || endpointFor(selectedProvider), directory)
      }
    }

    for (const config of configs) {
      for (const [name, value] of Object.entries(config)) {
        inspectCredentials(name, value)
      }
      for (const [name, value] of Object.entries(record(config['profiles']))) {
        inspectCredentials(name, value)
      }
      // Hermes keeps provider state and multiple keys in separate sections.
      for (const [name, value] of Object.entries(record(config['providers']))) {
        inspectCredentials(name, value)
      }
      for (const [name, entries] of Object.entries(record(config['credential_pool']))) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            inspectCredentials(name, entry)
          }
        }
      }
    }

    const providers = record(settings['provider'] || settings['providers'] || settings['model_providers'] || record(settings['models'])['providers'])
    for (const [name, value] of Object.entries(providers)) {
      const selectedProvider = provider(name)
      const options = { ...record(value), ...record(record(value)['options']) }
      const variable = string(options['env_key'])
      const configuredKey = resolveKey(options['apiKey'] || options['api_key']) ||
        (variable ? string(env[variable] || environment.env[variable]) : '')

      if (selectedProvider && configuredKey) {
        add(fellow, selectedProvider, FellowAuthType.APIKey, configuredFor(selectedProvider),
          configuredKey, string(options['baseURL']) || string(options['baseUrl']) || string(options['base_url']), directory)
      }
    }

    if (fellow.id === 'codex') {
      const key = string(settings['OPENAI_API_KEY'])
      if (key) {
        add(fellow, LLMProviders.OpenAI, FellowAuthType.APIKey, configuredModel, key, endpointFor(LLMProviders.OpenAI), directory)
      } else if (settings['tokens']) {
        add(fellow, LLMProviders.OpenAI, FellowAuthType.ChatGPT, configuredModel, '', '', directory)
      } else {
        // Login status can identify keyring-backed accounts without extracting tokens.
        const status = await execa('codex', ['login', 'status'], {
          env: { ...environment.env, CODEX_HOME: directory },
          timeout: CLI_STATUS_TIMEOUT_MS,
          reject: false
        }).catch(() => null)
        if (status?.exitCode === 0 &&
          `${status.stdout} ${status.stderr}`.toLowerCase().includes('chatgpt')) {
          add(fellow, LLMProviders.OpenAI, FellowAuthType.ChatGPT, configuredModel, '', '', directory)
        }
      }
    }

    if (fellow.id === 'claude-code') {
      if (await isClaudeSubscriptionAvailable(directory, environment.env)) {
        add(fellow, LLMProviders.Anthropic, FellowAuthType.ClaudeCode, configuredModel, '', '', directory)
      }
    }

    if (fellow.id === 't3-code') {
      referencedClaudeDirectories(settings, claudeDirectories)
      for (const instance of Object.values(record(settings['providerInstances']))) {
        const variables = record(instance)['environment']
        if (!Array.isArray(variables)) {
          continue
        }
        const instanceEnv = Object.fromEntries(variables.map((variable) => {
          const entry = record(variable)
          return [string(entry['name']), string(entry['value'])]
        }))
        for (const [name, selectedProvider] of Object.entries(ENV_PROVIDERS)) {
          const key = string(instanceEnv[name])
          if (key) {
            const endpoint = selectedProvider === LLMProviders.Anthropic
              ? string(instanceEnv['ANTHROPIC_BASE_URL']) : string(instanceEnv['OPENAI_BASE_URL'])
            add(fellow, selectedProvider, FellowAuthType.APIKey, '', key, endpoint, directory)
          }
        }
      }
    }

    if (fellow.accountStores) {
      const storesConfig = fellow.accountStores
      const agents = await fs.readdir(path.join(directory, 'agents')).catch(() => [])
      const stores = [path.join(directory, storesConfig.shared),
        ...agents.slice(0, MAX_REFERENCED_DIRECTORIES).map((agent) =>
          path.join(directory, storesConfig.agent.replace('<agentId>', agent)))]

      for (const file of stores) {
        let database: InstanceType<typeof Database> | undefined
        const exists = await fs.stat(file).then(() => true).catch(() => false)
        try {
          if (exists) {
            database = new Database(file, { readonly: true, fileMustExist: true })
            const shared = file === stores[0]
            const row = database.prepare(shared
              ? 'SELECT value_json AS payload FROM config_machine_state WHERE state_key = \'authProfiles.store\''
              : 'SELECT store_json AS payload FROM auth_profile_store WHERE store_key = \'primary\'')
              .get() as { payload: string } | undefined
            if (row && row.payload.length <= MAX_CONFIG_BYTES) {
              const profiles = record(record(JSON.parse(row.payload))['profiles'])
              for (const [name, value] of Object.entries(profiles)) {
                inspectCredentials(name, value)
              }
            }
          } else if (file !== stores[0]) {
            // Legacy files are read only when the canonical database is absent.
            const legacy = await readConfig(path.join(path.dirname(file), storesConfig.legacy), 'json')
            for (const [name, value] of Object.entries(record(legacy['profiles']))) {
              inspectCredentials(name, value)
            }
          }
        } catch (error) {
          if (exists || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
            result.issues.push('OpenClaw: I could not read one of its account stores.')
          }
        } finally {
          database?.close()
        }
      }
    }
  }

  for (const fellow of FELLOWS) {
    await inspect(fellow, getFellowDirectory(fellow, environment))
  }
  const claude = FELLOWS.find((fellow) => fellow.id === 'claude-code')!
  for (const directory of claudeDirectories) {
    const resolved = path.resolve(directory.startsWith('~/')
      ? path.join(environment.home, directory.slice(2)) : directory)
    await inspect(claude, resolved)
    for (const connection of result.connections) {
      if (connection.configDirectory === resolved && !connection.sources.includes('T3 Code')) {
        connection.sources.push('T3 Code')
      }
    }
  }

  result.connections.sort((a, b) => {
    const authentication = Number(a.authType === FellowAuthType.APIKey) -
      Number(b.authType === FellowAuthType.APIKey)
    const providerOrder = (value: LLMProviders): number => {
      const index = order.indexOf(value)
      return index === -1 ? order.length : index
    }

    return authentication || providerOrder(a.provider) - providerOrder(b.provider) ||
      a.sources.join().localeCompare(b.sources.join())
  })

  return result
}
