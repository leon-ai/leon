import {
  Type,
  type Static,
  type TNull,
  type TObject,
  type TProperties,
  type TString,
  type TUnion
} from '@sinclair/typebox'

import {
  LLM_MODEL_REASONING_VALUES,
  LLM_MODEL_SPEED_VALUES
} from '@/core/llm-manager/llm-model-catalog'

const nullableString = (description: string): TUnion<[TString, TNull]> => Type.Union(
  [Type.String(), Type.Null()],
  { description }
)
const strictObject = <T extends TProperties>(
  properties: T,
  description: string
): TObject<T> => Type.Strict(Type.Object(properties, {
  additionalProperties: false,
  description
}))

const secretReference = strictObject({
  env: Type.String({
    pattern: '^[A-Z0-9_]+$',
    description: 'Name of the environment variable containing the secret.'
  })
}, 'Reference to a secret stored in the profile environment.')
const clientInterfaceAuth = strictObject({
  enabled: Type.Boolean({
    description: 'Require a profile token for authenticated access to this interface.'
  }),
  token: secretReference
}, 'Token authentication settings for this interface.')
const accessListProperties = {
  allowed: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true,
    description: 'IDs the profile may use. An empty list allows all installed entries subject to availability and disablement.'
  }),
  disabled: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true,
    description: 'IDs explicitly disabled for the profile, including entries in the allowlist.'
  })
}
const providerToggleProperties = {
  enabled: Type.Boolean({ description: 'Enable this voice capability.' }),
  provider: Type.String({
    minLength: 1,
    description: 'ID of the provider Leon uses for this voice capability.'
  })
}
const httpPluginDefinition = strictObject({
  enabled: Type.Boolean({
    description: 'Enable this plugin when HTTP plugins are enabled for the profile.'
  }),
  root_routes: Type.Boolean({
    description: 'Allow this plugin to register routes outside its namespace when the profile permits root routes.'
  })
}, 'Profile settings for an individual HTTP plugin.')

const llmProviderAccount = Type.Optional(Type.String({
  minLength: 1,
  description: 'ID of a saved provider account selected for this profile.'
}))
const llmProviderBaseURL = Type.String({
  minLength: 1,
  description: 'Base URL the Leon server uses to send model inference requests to this provider.'
})
const llmProviderGenerationBaseURL = Type.Optional(Type.String({
  format: 'uri',
  description: 'Custom base URL for supported image and video generation requests.'
}))
const llmProviderAPIKey = strictObject(
  secretReference.properties,
  'Environment-backed API key used to authenticate requests to the provider.'
)
const llmProvider = strictObject({
  account: llmProviderAccount,
  base_url: Type.Optional(llmProviderBaseURL),
  generation_base_url: llmProviderGenerationBaseURL,
  api_key: llmProviderAPIKey
}, 'Connection settings for a model provider.')
// Keep optional markers until each provider's complete object is constructed.
const llmProviderWithBaseURLProperties = {
  account: llmProviderAccount,
  generation_base_url: llmProviderGenerationBaseURL,
  base_url: llmProviderBaseURL,
  api_key: llmProviderAPIKey
}
const llmProviderWithBaseURL = strictObject(
  llmProviderWithBaseURLProperties,
  'Connection settings for a provider with a configured inference endpoint.'
)
const llmModelSetting = strictObject({
  instructions_cache_ttl: Type.Optional(
    Type.Union([Type.Literal('30m'), Type.Literal('12h')], {
      description: 'Retention period for cached model instructions on supported routes.'
    })
  ),
  reasoning: Type.Optional(
    Type.Union(LLM_MODEL_REASONING_VALUES.map((value) => Type.Literal(value)), {
      description: 'Preferred reasoning mode or effort for this model when supported.'
    })
  ),
  speed: Type.Optional(
    Type.Union(LLM_MODEL_SPEED_VALUES.map((value) => Type.Literal(value)), {
      description: 'Preferred inference speed or service tier for this model when supported.'
    })
  )
}, 'Inference preferences for a specific model.')

export const configSchemaObject = strictObject({
  language: Type.String({
    minLength: 1,
    description: 'Locale Leon uses for replies and language-specific resources, such as en-US.'
  }),
  server: strictObject({
    public_url: Type.Optional(Type.String({
      format: 'uri',
      description: 'Externally reachable base URL used to build OAuth callback URLs. Omit to use the client origin.'
    })),
    host: Type.String({
      minLength: 1,
      description: 'HTTP or HTTPS origin of the Leon server, without its separately configured port.'
    }),
    port: Type.Integer({
      minimum: 1,
      maximum: 65_535,
      description: 'Port the HTTP server listens on.'
    })
  }, 'HTTP server address and public callback configuration.'),
  client_interface: strictObject({
    allowed_origins: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
      description: 'Additional browser origins permitted to connect to the HTTP and Socket.IO interfaces.'
    }),
    auth: clientInterfaceAuth
  }, 'Browser and client access settings.'),
  http_plugins: strictObject({
    enabled: Type.Boolean({
      description: 'Allow enabled external HTTP plugins to register routes for the profile.'
    }),
    allow_root_routes: Type.Boolean({
      description: 'Allow HTTP plugins to register routes outside their namespaces when individually permitted.'
    }),
    auth: clientInterfaceAuth,
    plugins: Type.Record(Type.String({ minLength: 1 }), httpPluginDefinition, {
      description: 'Activation and route permissions keyed by external HTTP plugin ID.'
    })
  }, 'External HTTP plugin activation, route permissions and authentication.'),
  routing: strictObject({
    mode: Type.Union([
      Type.Literal('smart'),
      Type.Literal('controlled'),
      Type.Literal('agent')
    ], {
      description: 'How Leon handles requests. Agent runs the agent loop, controlled uses native skill actions, and smart selects an appropriate route.'
    })
  }, 'Default request routing for the profile.'),
  llm: strictObject({
    default: nullableString(
      'Fallback language model target. Use a provider/model ID, a local model path, or null to leave it unset.'
    ),
    workflow: nullableString('Model target for workflow inference. Null inherits the default target.'),
    agent: nullableString('Model target for the agent loop. Null inherits the default target.'),
    model_settings: Type.Record(Type.String({ minLength: 1 }), llmModelSetting, {
      description: 'Per-model inference preferences keyed by model target.'
    }),
    providers: strictObject({
      llamacpp: strictObject({
        ...llmProviderWithBaseURLProperties,
        context_size: Type.Optional(Type.Integer({
          minimum: 1,
          description: 'Requested local context window in tokens. Omit to size it for the hardware automatically.'
        })),
        kv_cache_type: Type.Optional(Type.Union([
          Type.Literal('q8_0'), Type.Literal('q4_0')
        ], {
          description: 'Quantization used for the local key-value cache. Lower precision reduces memory use.'
        })),
        memory_reserve_mib: Type.Optional(Type.Integer({
          minimum: 1,
          description: 'Memory in MiB to leave available when planning local model placement on the host and GPUs.'
        }))
      }, 'Connection and resource limits for local llama.cpp inference.'),
      sglang: llmProviderWithBaseURL,
      openrouter: llmProvider,
      zai: llmProvider,
      deepseek: llmProvider,
      minimax: llmProviderWithBaseURL,
      openai: llmProvider,
      anthropic: llmProvider,
      moonshotai: llmProvider,
      huggingface: llmProvider,
      cerebras: llmProvider,
      groq: llmProvider,
      celeris: llmProviderWithBaseURL
    }, 'Endpoint and authentication settings for supported model providers.')
  }, 'Model targets, inference preferences and provider connections for the profile.'),
  mood: strictObject({
    mode: Type.Union([
      Type.Literal('auto'),
      Type.Literal('default'),
      Type.Literal('tired'),
      Type.Literal('cocky'),
      Type.Literal('sad'),
      Type.Literal('angry')
    ], {
      description: 'Use auto to let Leon determine its mood, or choose a fixed mood for its replies.'
    })
  }, 'Mood settings that shape how Leon replies.'),
  runtime: strictObject({
    agent_execution_timeout_seconds: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        description: 'Optional time budget in seconds for an agent turn.'
      })
    ),
    agent_max_iterations: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
        description: 'Maximum number of agent loop iterations per turn.'
      })
    ),
    pulse_enabled: Type.Boolean({
      description: 'Enable Pulse to proactively investigate or follow up on relevant matters.'
    }),
    private_diary_enabled: Type.Boolean({
      description: 'Enable Leon to maintain and use its private diary and learned service habits.'
    }),
    experience_enabled: Type.Optional(Type.Boolean({
      description: 'Enable learning and reusing procedures from completed conversations. Defaults to enabled.'
    })),
    progressive_toolkit_loading: Type.Boolean({
      description: 'Load tool schemas on demand as the agent selects relevant toolkits.'
    })
  }, 'Agent execution limits and background behavior.'),
  context: strictObject({
    disabled_files: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
      description: 'Context filenames excluded from context generation and retrieval for this profile.'
    })
  }, 'Profile controls for generated context files.'),
  availability: strictObject({
    skills: strictObject(accessListProperties, 'Allowlist and disable list of skill IDs.'),
    tools: strictObject(
      accessListProperties,
      'Allowlist and disable list of tool IDs or qualified toolkit.tool IDs.'
    )
  }, 'Profile access rules for installed skills and tools.'),
  satellite: Type.Optional(
    strictObject({
      tools: Type.Record(
        Type.String({ minLength: 1 }),
        Type.String({ minLength: 1 }),
        {
          description: 'Execution assignments from qualified toolkit.tool IDs to paired device IDs. Use $core to select the server host.'
        }
      )
    }, 'Execution assignments for tools that can run on a paired device.')
  ),
  python_tcp_server: strictObject({
    host: Type.String({
      minLength: 1,
      description: 'Hostname or IP address of the Python TCP server.'
    }),
    port: Type.Integer({
      minimum: 1,
      maximum: 65_535,
      description: 'TCP port used for communication with the Python TCP server.'
    })
  }, 'Address for the Python TCP server used by local services.'),
  voice: strictObject({
    wake_word_enabled: Type.Boolean({
      description: 'Enable wake-word detection to start voice interaction.'
    }),
    asr: strictObject(
      providerToggleProperties,
      'Automatic speech recognition settings for transcribing voice input.'
    ),
    tts: strictObject(providerToggleProperties, 'Text-to-speech settings for speaking replies aloud.')
  }, 'Wake-word detection, speech recognition and speech synthesis settings.'),
  time_zone: nullableString('IANA time zone used for local dates and times. Null uses the host time zone.'),
  after_speech_enabled: Type.Boolean({
    description: 'Automatically start recording again after Leon finishes speaking a final answer in the legacy web client.'
  }),
  telemetry_enabled: Type.Boolean({
    description: 'Permit Leon to send its usage telemetry.'
  })
}, 'Leon profile configuration.')

export type LeonConfigSchema = Static<typeof configSchemaObject>
export type SecretReferenceSchema = Static<typeof secretReference>
export type LLMProviderConfigSchema = Static<typeof llmProvider> & {
  base_url?: string
}
