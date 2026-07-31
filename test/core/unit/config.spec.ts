import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncedEnvKeys = [
  'LEON_LANG',
  'LEON_HOST',
  'LEON_PORT',
  'LEON_ROUTING_MODE',
  'LEON_MOOD',
  'LEON_LLM',
  'LEON_WORKFLOW_LLM',
  'LEON_AGENT_LLM',
  'LEON_WAKE_WORD',
  'LEON_ASR',
  'LEON_ASR_PROVIDER',
  'LEON_TTS',
  'LEON_TTS_PROVIDER',
  'LEON_TIME_ZONE',
  'LEON_AFTER_SPEECH',
  'LEON_TELEMETRY',
  'LEON_PY_TCP_SERVER_HOST',
  'LEON_PY_TCP_SERVER_PORT',
  'LEON_LLAMACPP_BASE_URL',
  'LEON_SGLANG_BASE_URL',
  'LEON_PROFILE_TOKEN',
  'LEON_OPENAI_API_KEY'
]

const profilePaths = {
  configPath: ''
}

async function loadConfigManager(): Promise<
  typeof import('@/config').CONFIG_MANAGER
> {
  vi.doMock('@/leon-roots', () => ({
    LEON_PROFILE_NAME: 'test-profile'
  }))
  vi.doMock('@/core/profile-runtime/profile-paths', () => ({
    getProfilePaths: (): { config: string, dotEnv: string } => ({
      config: profilePaths.configPath,
      dotEnv: path.join(path.dirname(profilePaths.configPath), '.env')
    })
  }))

  const module = await import('@/config')

  return module.CONFIG_MANAGER
}

describe('ConfigManager', () => {
  let tmpDir = ''
  let previousEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-config-'))
    profilePaths.configPath = path.join(tmpDir, 'config.yml')
    previousEnv = Object.fromEntries(
      syncedEnvKeys.map((key) => [key, process.env[key]])
    )
    vi.resetModules()
  })

  afterEach(() => {
    for (const key of syncedEnvKeys) {
      const value = previousEnv[key]

      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    fs.rmSync(tmpDir, {
      recursive: true,
      force: true
    })
  })

  it('returns profile config values and syncs runtime env mappings', async () => {
    process.env['LEON_PROFILE_TOKEN'] = 'client-secret'
    process.env['LEON_OPENAI_API_KEY'] = 'openai-secret'

    const profileConfig = {
      language: 'fr-FR',
      server: {
        host: 'http://127.0.0.1',
        port: 5_499
      },
      client_interface: {
        allowed_origins: ['http://localhost:1420'],
        auth: {
          enabled: true,
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
        mode: 'controlled'
      },
      llm: {
        default: null,
        workflow: 'openai/gpt-4.1-mini',
        agent: null,
        model_settings: {},
        providers: {
          llamacpp: {
            base_url: 'http://127.0.0.1:8081/v1',
            api_key: {
              env: 'LEON_LLAMACPP_API_KEY'
            }
          },
          sglang: {
            base_url: 'http://127.0.0.1:30001/v1',
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
            base_url: 'https://api.minimaxi.com/anthropic',
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
      },
      mood: {
        mode: 'tired'
      },
      runtime: {
        pulse_enabled: false,
        private_diary_enabled: false,
        progressive_toolkit_loading: false
      },
      context: {
        disabled_files: ['*']
      },
      availability: {
        skills: {
          allowed: ['date_time_skill'],
          disabled: ['weather_forecast_skill']
        },
        tools: {
          allowed: ['coding_development.codex'],
          disabled: ['coding_development.claude_code']
        }
      },
      python_tcp_server: {
        host: '127.0.0.2',
        port: 5_477
      },
      voice: {
        wake_word_enabled: true,
        asr: {
          enabled: true,
          provider: 'local'
        },
        tts: {
          enabled: true,
          provider: 'local'
        }
      },
      time_zone: 'Europe/Paris',
      after_speech_enabled: true,
      telemetry_enabled: false
    }

    fs.writeFileSync(profilePaths.configPath, YAML.stringify(profileConfig))

    const configManager = await loadConfigManager()

    expect(configManager.getConfig()).toEqual(profileConfig)
    expect(process.env['LEON_LANG']).toBe('fr-FR')
    expect(process.env['LEON_HOST']).toBe('http://127.0.0.1')
    expect(process.env['LEON_PORT']).toBe('5499')
    expect(process.env['LEON_ROUTING_MODE']).toBe('controlled')
    expect(process.env['LEON_MOOD']).toBe('tired')
    expect(process.env['LEON_LLM']).toBe('')
    expect(process.env['LEON_WORKFLOW_LLM']).toBe('openai/gpt-4.1-mini')
    expect(process.env['LEON_AGENT_LLM']).toBe('')
    expect(process.env['LEON_TIME_ZONE']).toBe('Europe/Paris')
    expect(process.env['LEON_PY_TCP_SERVER_PORT']).toBe('5477')
    expect(configManager.resolveSecretReference(
      profileConfig.client_interface.auth.token
    )).toBe('client-secret')
    expect(configManager.getProviderAPIKeyEnv('openai')).toBe(
      'LEON_OPENAI_API_KEY'
    )
    expect(configManager.getProviderAPIKey('openai')).toBe('openai-secret')
    expect(configManager.getProviderBaseURL('llamacpp')).toBe(
      'http://127.0.0.1:8081/v1'
    )
    expect(configManager.getProviderBaseURL('minimax')).toBe(
      'https://api.minimaxi.com/anthropic'
    )
  })
})
