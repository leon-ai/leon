import fs from 'node:fs'
import path from 'node:path'

import YAML from 'yaml'
import dotenv from 'dotenv'

import { LEON_PROFILE_NAME } from '@/leon-roots'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type {
  LLMProviderConfigSchema,
  LeonConfigSchema,
  SecretReferenceSchema
} from '@/schemas/core-schemas'

export type LeonConfig = LeonConfigSchema
export type SecretReference = SecretReferenceSchema
type LLMProviderConfig = LLMProviderConfigSchema
type OptionalStringConfigValue = LeonConfig['llm']['default']

const DEFAULT_CONFIG: LeonConfig = {
  language: 'en-US',
  server: {
    host: 'http://localhost',
    port: 5_366
  },
  client_interface: {
    allowed_origins: [],
    auth: {
      enabled: false,
      token: {
        env: 'LEON_PROFILE_TOKEN'
      }
    }
  },
  http_plugins: {
    enabled: false,
    allow_root_routes: false,
    auth: {
      enabled: false,
      token: {
        env: 'LEON_PROFILE_TOKEN'
      }
    },
    plugins: {}
  },
  routing: {
    mode: 'smart'
  },
  mood: {
    mode: 'auto'
  },
  runtime: {
    pulse_enabled: true,
    private_diary_enabled: true
  },
  context: {
    disabled_files: []
  },
  availability: {
    skills: {
      allowed: [],
      disabled: []
    },
    tools: {
      allowed: [],
      disabled: []
    }
  },
  voice: {
    wake_word_enabled: false,
    asr: {
      enabled: false,
      provider: 'local'
    },
    tts: {
      enabled: false,
      provider: 'local'
    }
  },
  time_zone: null,
  after_speech_enabled: false,
  telemetry_enabled: true,
  python_tcp_server: {
    host: '127.0.0.1',
    port: 5_367
  },
  llm: {
    default: null,
    workflow: null,
    agent: null,
    providers: {
      llamacpp: {
        base_url: 'http://127.0.0.1:8080/v1',
        api_key: {
          env: 'LEON_LLAMACPP_API_KEY'
        }
      },
      sglang: {
        base_url: 'http://127.0.0.1:30000/v1',
        api_key: {
          env: 'LEON_SGLANG_API_KEY'
        }
      },
      openrouter: {
        api_key: {
          env: 'LEON_OPENROUTER_API_KEY'
        }
      },
      zai: {
        api_key: {
          env: 'LEON_ZAI_API_KEY'
        }
      },
      minimax: {
        api_key: {
          env: 'LEON_MINIMAX_API_KEY'
        }
      },
      openai: {
        api_key: {
          env: 'LEON_OPENAI_API_KEY'
        }
      },
      anthropic: {
        api_key: {
          env: 'LEON_ANTHROPIC_API_KEY'
        }
      },
      moonshotai: {
        api_key: {
          env: 'LEON_MOONSHOTAI_API_KEY'
        }
      },
      huggingface: {
        api_key: {
          env: 'LEON_HUGGINGFACE_API_KEY'
        }
      },
      cerebras: {
        api_key: {
          env: 'LEON_CEREBRAS_API_KEY'
        }
      },
      groq: {
        api_key: {
          env: 'LEON_GROQ_API_KEY'
        }
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (!isPlainObject(defaults)) {
    return (value === undefined ? defaults : value) as T
  }

  const merged: Record<string, unknown> = { ...defaults }
  const source = isPlainObject(value) ? value : {}

  for (const [key, sourceValue] of Object.entries(source)) {
    const defaultValue = (defaults as Record<string, unknown>)[key]

    merged[key] = isPlainObject(defaultValue)
      ? mergeDefaults(defaultValue, sourceValue)
      : sourceValue
  }

  return merged as T
}

function normalizeStringList(values: Set<string>): string[] {
  return [...values]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((firstValue, secondValue) => firstValue.localeCompare(secondValue))
}

function toEnvString(value: OptionalStringConfigValue): string {
  return value ?? ''
}

class ConfigManager {
  private static instance: ConfigManager

  private readonly configs = new Map<string, LeonConfig>()
  private readonly profileEnvValues = new Map<string, Record<string, string>>()

  private constructor() {
    const config = this.load(LEON_PROFILE_NAME)

    this.configs.set(LEON_PROFILE_NAME, config)
    this.syncProcessEnv(config)
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }

    return ConfigManager.instance
  }

  public getConfig(profileName = getActiveProfileName()): LeonConfig {
    const cachedConfig = this.configs.get(profileName)

    if (cachedConfig) {
      return cachedConfig
    }

    const config = this.load(profileName)

    this.configs.set(profileName, config)

    return config
  }

  public reload(profileName = getActiveProfileName()): LeonConfig {
    this.profileEnvValues.delete(profileName)
    const config = this.load(profileName)

    this.configs.set(profileName, config)

    // Legacy child processes still read the startup profile from process.env.
    if (profileName === LEON_PROFILE_NAME) {
      this.syncProcessEnv(config)
    }

    return config
  }

  public resolveSecretReference(
    reference: SecretReference,
    profileName = getActiveProfileName()
  ): string {
    const profileValue = this.getProfileEnvValues(profileName)[reference.env]

    if (profileValue) {
      return profileValue
    }

    // Only the startup profile may inherit process-level secrets. Otherwise a
    // missing tenant secret could accidentally fall back to another profile.
    return profileName === LEON_PROFILE_NAME
      ? process.env[reference.env] || ''
      : ''
  }

  public getProviderConfig(provider: string): LLMProviderConfig | null {
    const providers = this.getConfig().llm.providers as Record<
      string,
      LLMProviderConfig
    >

    return providers[provider] || null
  }

  public getProviderAPIKeyEnv(provider: string): string | null {
    return this.getProviderConfig(provider)?.api_key.env || null
  }

  public getProviderAPIKey(provider: string): string {
    const providerConfig = this.getProviderConfig(provider)

    return providerConfig
      ? this.resolveSecretReference(providerConfig.api_key)
      : ''
  }

  public getProviderBaseURL(provider: string): string {
    return this.getProviderConfig(provider)?.base_url || ''
  }

  public async setValue(keyPath: string[], value: unknown): Promise<void> {
    const profileName = getActiveProfileName()
    const document = this.readDocument(profileName)

    document.setIn(keyPath, value)
    await this.writeDocument(document, profileName)
    this.reload(profileName)
  }

  public async setStringList(
    keyPath: string[],
    values: Set<string>
  ): Promise<void> {
    await this.setValue(keyPath, normalizeStringList(values))
  }

  private load(profileName: string): LeonConfig {
    const parsedConfig = this.readRawConfig(profileName)
    const mergedConfig = mergeDefaults(
      cloneConfig(DEFAULT_CONFIG),
      parsedConfig
    )

    return mergedConfig
  }

  private readRawConfig(profileName: string): Record<string, unknown> {
    const configPath = getProfilePaths(profileName).config

    if (!fs.existsSync(configPath)) {
      return {}
    }

    try {
      const rawConfig = fs.readFileSync(configPath, 'utf8')
      const parsedConfig = YAML.parse(rawConfig)

      if (!isPlainObject(parsedConfig)) {
        throw new Error('The root value must be a YAML object.')
      }

      return parsedConfig
    } catch (error) {
      throw new Error(
        `Failed to read profile config at "${configPath}": ${String(error)}`
      )
    }
  }

  private readDocument(profileName: string): YAML.Document.Parsed {
    const configPath = getProfilePaths(profileName).config
    const rawConfig = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, 'utf8')
      : YAML.stringify(DEFAULT_CONFIG)

    return YAML.parseDocument(rawConfig)
  }

  private async writeDocument(
    document: YAML.Document.Parsed,
    profileName: string
  ): Promise<void> {
    const rawValue = document.toJSON()

    if (!isPlainObject(rawValue)) {
      throw new Error('Cannot save a profile config without a YAML object root.')
    }

    const configPath = getProfilePaths(profileName).config

    await fs.promises.mkdir(path.dirname(configPath), {
      recursive: true
    })
    await fs.promises.writeFile(configPath, String(document))
  }

  private getProfileEnvValues(profileName: string): Record<string, string> {
    const cachedValues = this.profileEnvValues.get(profileName)

    if (cachedValues) {
      return cachedValues
    }

    const dotEnvPath = getProfilePaths(profileName).dotEnv
    const values = fs.existsSync(dotEnvPath)
      ? dotenv.parse(fs.readFileSync(dotEnvPath, 'utf8'))
      : {}

    this.profileEnvValues.set(profileName, values)

    return values
  }

  private syncProcessEnv(config: LeonConfig): void {
    process.env['LEON_LANG'] = config.language
    process.env['LEON_HOST'] = config.server.host
    process.env['LEON_PORT'] = String(config.server.port)
    process.env['LEON_ROUTING_MODE'] = config.routing.mode
    process.env['LEON_MOOD'] = config.mood.mode
    process.env['LEON_LLM'] = toEnvString(config.llm.default)
    process.env['LEON_WORKFLOW_LLM'] = toEnvString(config.llm.workflow)
    process.env['LEON_AGENT_LLM'] = toEnvString(config.llm.agent)
    process.env['LEON_WAKE_WORD'] = config.voice.wake_word_enabled
      ? 'true'
      : 'false'
    process.env['LEON_ASR'] = config.voice.asr.enabled ? 'true' : 'false'
    process.env['LEON_ASR_PROVIDER'] = config.voice.asr.provider
    process.env['LEON_TTS'] = config.voice.tts.enabled ? 'true' : 'false'
    process.env['LEON_TTS_PROVIDER'] = config.voice.tts.provider
    process.env['LEON_TIME_ZONE'] = toEnvString(config.time_zone)
    process.env['LEON_AFTER_SPEECH'] = config.after_speech_enabled
      ? 'true'
      : 'false'
    process.env['LEON_TELEMETRY'] = config.telemetry_enabled
      ? 'true'
      : 'false'
    process.env['LEON_PY_TCP_SERVER_HOST'] = config.python_tcp_server.host
    process.env['LEON_PY_TCP_SERVER_PORT'] = String(
      config.python_tcp_server.port
    )
    process.env['LEON_LLAMACPP_BASE_URL'] =
      config.llm.providers['llamacpp']?.base_url || ''
    process.env['LEON_SGLANG_BASE_URL'] =
      config.llm.providers['sglang']?.base_url || ''
  }
}

export { ConfigManager }

export const CONFIG_MANAGER = ConfigManager.getInstance()
