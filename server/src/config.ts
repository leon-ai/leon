import fs from 'node:fs'
import path from 'node:path'

import YAML from 'yaml'

import { PROFILE_CONFIG_PATH } from '@/leon-roots'
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
  http: {
    enabled: true,
    lang: 'en-US',
    api_key: {
      env: 'LEON_HTTP_API_KEY'
    }
  },
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

  private config: LeonConfig

  private constructor() {
    this.config = this.load()
    this.syncProcessEnv()
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }

    return ConfigManager.instance
  }

  public getConfig(): LeonConfig {
    return this.config
  }

  public reload(): LeonConfig {
    this.config = this.load()
    this.syncProcessEnv()

    return this.config
  }

  public resolveSecretReference(reference: SecretReference): string {
    return process.env[reference.env] || ''
  }

  public getProviderConfig(provider: string): LLMProviderConfig | null {
    const providers = this.config.llm.providers as Record<
      string,
      LLMProviderConfig
    >

    return providers[provider] || null
  }

  public getProviderAPIKeyEnv(provider: string): string | null {
    return this.getProviderConfig(provider)?.api_key.env || null
  }

  public getProviderAPIKey(provider: string): string {
    const envName = this.getProviderAPIKeyEnv(provider)

    return envName ? process.env[envName] || '' : ''
  }

  public getProviderBaseURL(provider: string): string {
    return this.getProviderConfig(provider)?.base_url || ''
  }

  public async setValue(keyPath: string[], value: unknown): Promise<void> {
    const document = this.readDocument()

    document.setIn(keyPath, value)
    await this.writeDocument(document)
    this.reload()
  }

  public async setStringList(
    keyPath: string[],
    values: Set<string>
  ): Promise<void> {
    await this.setValue(keyPath, normalizeStringList(values))
  }

  private load(): LeonConfig {
    const parsedConfig = this.readRawConfig()
    const mergedConfig = mergeDefaults(
      cloneConfig(DEFAULT_CONFIG),
      parsedConfig
    )

    return mergedConfig
  }

  private readRawConfig(): Record<string, unknown> {
    if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
      return {}
    }

    try {
      const rawConfig = fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8')
      const parsedConfig = YAML.parse(rawConfig)

      if (!isPlainObject(parsedConfig)) {
        throw new Error('The root value must be a YAML object.')
      }

      return parsedConfig
    } catch (error) {
      throw new Error(
        `Failed to read profile config at "${PROFILE_CONFIG_PATH}": ${String(error)}`
      )
    }
  }

  private readDocument(): YAML.Document.Parsed {
    const rawConfig = fs.existsSync(PROFILE_CONFIG_PATH)
      ? fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8')
      : YAML.stringify(DEFAULT_CONFIG)

    return YAML.parseDocument(rawConfig)
  }

  private async writeDocument(document: YAML.Document.Parsed): Promise<void> {
    const rawValue = document.toJSON()

    if (!isPlainObject(rawValue)) {
      throw new Error('Cannot save a profile config without a YAML object root.')
    }

    await fs.promises.mkdir(path.dirname(PROFILE_CONFIG_PATH), {
      recursive: true
    })
    await fs.promises.writeFile(PROFILE_CONFIG_PATH, String(document))
  }

  private syncProcessEnv(): void {
    process.env['LEON_LANG'] = this.config.language
    process.env['LEON_HOST'] = this.config.server.host
    process.env['LEON_PORT'] = String(this.config.server.port)
    process.env['LEON_ROUTING_MODE'] = this.config.routing.mode
    process.env['LEON_MOOD'] = this.config.mood.mode
    process.env['LEON_LLM'] = toEnvString(this.config.llm.default)
    process.env['LEON_WORKFLOW_LLM'] = toEnvString(this.config.llm.workflow)
    process.env['LEON_AGENT_LLM'] = toEnvString(this.config.llm.agent)
    process.env['LEON_WAKE_WORD'] = this.config.voice.wake_word_enabled
      ? 'true'
      : 'false'
    process.env['LEON_ASR'] = this.config.voice.asr.enabled ? 'true' : 'false'
    process.env['LEON_ASR_PROVIDER'] = this.config.voice.asr.provider
    process.env['LEON_TTS'] = this.config.voice.tts.enabled ? 'true' : 'false'
    process.env['LEON_TTS_PROVIDER'] = this.config.voice.tts.provider
    process.env['LEON_TIME_ZONE'] = toEnvString(this.config.time_zone)
    process.env['LEON_AFTER_SPEECH'] = this.config.after_speech_enabled
      ? 'true'
      : 'false'
    process.env['LEON_OVER_HTTP'] = this.config.http.enabled ? 'true' : 'false'
    process.env['LEON_HTTP_API_LANG'] = this.config.http.lang
    process.env['LEON_TELEMETRY'] = this.config.telemetry_enabled
      ? 'true'
      : 'false'
    process.env['LEON_PY_TCP_SERVER_HOST'] = this.config.python_tcp_server.host
    process.env['LEON_PY_TCP_SERVER_PORT'] = String(
      this.config.python_tcp_server.port
    )
    process.env['LEON_LLAMACPP_BASE_URL'] =
      this.config.llm.providers['llamacpp']?.base_url || ''
    process.env['LEON_SGLANG_BASE_URL'] =
      this.config.llm.providers['sglang']?.base_url || ''
  }
}

export { ConfigManager }

export const CONFIG_MANAGER = ConfigManager.getInstance()
