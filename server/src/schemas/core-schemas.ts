import {
  Type,
  type Static,
  type TObject,
  type TProperties
} from '@sinclair/typebox'

import {
  LLM_MODEL_REASONING_VALUES,
  LLM_MODEL_SPEED_VALUES
} from '@/core/llm-manager/llm-model-catalog'

const optionalString = Type.Union([Type.String(), Type.Null()])
const strictObject = <T extends TProperties>(properties: T): TObject<T> =>
  Type.Strict(Type.Object(properties, { additionalProperties: false }))

const secretReference = strictObject({
  env: Type.String({ pattern: '^[A-Z0-9_]+$' })
})
const clientInterfaceAuth = strictObject({
  enabled: Type.Boolean(),
  token: secretReference
})
const accessList = strictObject({
  allowed: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true
  }),
  disabled: Type.Array(Type.String({ minLength: 1 }), {
    uniqueItems: true
  })
})
const providerToggle = strictObject({
  enabled: Type.Boolean(),
  provider: Type.String({ minLength: 1 })
})
const httpPluginDefinition = strictObject({
  enabled: Type.Boolean(),
  root_routes: Type.Boolean()
})
const llmProvider = strictObject({
  api_key: secretReference
})
const llmProviderWithBaseURL = strictObject({
  base_url: Type.String({ minLength: 1 }),
  api_key: secretReference
})
const llmModelSetting = strictObject({
  reasoning: Type.Optional(
    Type.Union(
      LLM_MODEL_REASONING_VALUES.map((value) => Type.Literal(value))
    )
  ),
  speed: Type.Optional(
    Type.Union(LLM_MODEL_SPEED_VALUES.map((value) => Type.Literal(value)))
  )
})

export const configSchemaObject = strictObject({
  language: Type.String({ minLength: 1 }),
  server: strictObject({
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 })
  }),
  client_interface: strictObject({
    allowed_origins: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true
    }),
    auth: clientInterfaceAuth
  }),
  http_plugins: strictObject({
    enabled: Type.Boolean(),
    allow_root_routes: Type.Boolean(),
    auth: clientInterfaceAuth,
    plugins: Type.Record(Type.String({ minLength: 1 }), httpPluginDefinition)
  }),
  routing: strictObject({
    mode: Type.Union([
      Type.Literal('smart'),
      Type.Literal('controlled'),
      Type.Literal('agent')
    ])
  }),
  llm: strictObject({
    default: optionalString,
    workflow: optionalString,
    agent: optionalString,
    model_settings: Type.Record(
      Type.String({ minLength: 1 }),
      llmModelSetting
    ),
    providers: strictObject({
      llamacpp: llmProviderWithBaseURL,
      sglang: llmProviderWithBaseURL,
      openrouter: llmProvider,
      zai: llmProvider,
      minimax: llmProviderWithBaseURL,
      openai: llmProvider,
      anthropic: llmProvider,
      moonshotai: llmProvider,
      huggingface: llmProvider,
      cerebras: llmProvider,
      groq: llmProvider,
      celeris: llmProviderWithBaseURL
    })
  }),
  mood: strictObject({
    mode: Type.Union([
      Type.Literal('auto'),
      Type.Literal('default'),
      Type.Literal('tired'),
      Type.Literal('cocky'),
      Type.Literal('sad'),
      Type.Literal('angry')
    ])
  }),
  runtime: strictObject({
    pulse_enabled: Type.Boolean(),
    private_diary_enabled: Type.Boolean(),
    progressive_toolkit_loading: Type.Boolean()
  }),
  context: strictObject({
    disabled_files: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true
    })
  }),
  availability: strictObject({
    skills: accessList,
    tools: accessList
  }),
  python_tcp_server: strictObject({
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 })
  }),
  voice: strictObject({
    wake_word_enabled: Type.Boolean(),
    asr: providerToggle,
    tts: providerToggle
  }),
  time_zone: optionalString,
  after_speech_enabled: Type.Boolean(),
  telemetry_enabled: Type.Boolean()
})

export type LeonConfigSchema = Static<typeof configSchemaObject>
export type SecretReferenceSchema = Static<typeof secretReference>
export type LLMProviderConfigSchema = Static<typeof llmProvider> & {
  base_url?: string
}
