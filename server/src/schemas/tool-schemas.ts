import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'
import { ToolConcurrency } from '@/types'

import {
  PROGRESSIVE_GUIDANCE_MAX_LENGTH,
  REMIX_ICON_NAME_PATTERN
} from '@/constants'

const toolAuthorSchemaObject = Type.Strict(
  Type.Object(
    {
      name: Type.String({
        minLength: 1,
        description: 'Display name of the tool author.'
      }),
      email: Type.Optional(
        Type.String({
          minLength: 3,
          description: 'Contact email address for the tool author.'
        })
      ),
      url: Type.Optional(
        Type.String({
          minLength: 3,
          description: 'Public profile or website for the tool author.'
        })
      )
    },
    {
      description: 'Author metadata for the tool manifest.'
    }
  )
)

const toolFunctionSchemaObject = Type.Strict(
  Type.Object(
    {
      description: Type.String({
        minLength: 8,
        maxLength: 256,
        description: 'Human-readable description of what the function does.'
      }),
      progressive_guidance: Type.Optional(
        Type.String({
          minLength: 8,
          maxLength: PROGRESSIVE_GUIDANCE_MAX_LENGTH,
          description:
            'Operational guidance loaded with this function schema before the agent constructs a call.'
        })
      ),
      parameters: Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            'JSON Schema describing the accepted function parameters.'
        }
      ),
      output_schema: Type.Optional(
        Type.Object(
          {},
          {
            additionalProperties: true,
            description: 'Optional JSON Schema describing the function output.'
          }
        )
      ),
      deduplicate_calls: Type.Optional(
        Type.Boolean({
          description:
            'Whether the agent should block repeated successful calls with the same input. Disable this for state reads whose result can change over time.'
        })
      ),
      hooks: Type.Optional(
        Type.Strict(
          Type.Object(
            {
              post_execution: Type.Optional(
                Type.Strict(
                  Type.Object(
                    {
                      response_jq: Type.Optional(
                        Type.String({
                          minLength: 1,
                          description:
                            'Default jq filter applied to the executor output after the function runs.'
                        })
                      )
                    },
                    {
                      description:
                        'Post-execution hook configuration for executor-side output shaping.'
                    }
                  )
                )
              )
            },
            {
              description:
                'Internal function hooks used by the runtime, not by the model.'
            }
          )
        )
      )
    },
    {
      description: 'Schema for a single callable function exposed by a tool.'
    }
  )
)

const toolOAuthSchemaObject = Type.Object({
  authorization_url: Type.String({ format: 'uri' }),
  token_url: Type.String({ format: 'uri' }),
  scopes: Type.Array(Type.String()),
  uses_pkce: Type.Optional(Type.Boolean()),
  token_auth: Type.Union([
    Type.Literal('basic'),
    Type.Literal('body'),
    Type.Literal('none')
  ]),
  token_format: Type.Union([Type.Literal('json'), Type.Literal('form')]),
  authorization_parameters: Type.Optional(
    Type.Record(Type.String(), Type.String())
  ),
  token_parameters: Type.Optional(Type.Record(Type.String(), Type.String())),
  supports_refresh: Type.Boolean()
})

const toolConnectionMethodSchemaObject = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  setup_url: Type.String({ format: 'uri' }),
  // Optional provider guidance and copyable application values for first-time setup.
  setup: Type.Optional(
    Type.Object({
      instructions: Type.Array(Type.String({ minLength: 1 })),
      values: Type.Record(Type.String(), Type.String())
    })
  ),
  // Null defaults use the same mandatory-setting convention as settings.sample.json.
  settings: Type.Record(Type.String(), Type.Union([Type.Null(), Type.String()]))
})

export const toolConnectionSchemaObject = Type.Object({
  required_settings: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  methods: Type.Object({
    api_key: Type.Optional(toolConnectionMethodSchemaObject),
    oauth: Type.Optional(
      Type.Composite([toolConnectionMethodSchemaObject, toolOAuthSchemaObject])
    )
  })
})

export type ToolConnectionSchema = Static<typeof toolConnectionSchemaObject>

export type ToolOAuthSchema = Static<typeof toolOAuthSchemaObject>

export const toolManifestSchemaObject = Type.Strict(
  Type.Object(
    {
      $schema: Type.String({
        minLength: 1,
        description:
          'Path or URL to the JSON schema used to validate this manifest.'
      }),
      tool_id: Type.String({
        minLength: 1,
        description: 'Stable internal identifier for the tool.'
      }),
      toolkit_id: Type.String({
        minLength: 1,
        description: 'Identifier of the toolkit that owns this tool.'
      }),
      name: Type.String({
        minLength: 1,
        description: 'Human-readable tool name shown in interfaces.'
      }),
      concurrency: Type.Optional(
        Type.Enum(ToolConcurrency, {
          description:
            'Default parallel: independent calls use isolated workers. Use serial for tools owning a shared session, device or persistent instance state.'
        })
      ),
      description: Type.String({
        minLength: 8,
        maxLength: 272,
        description: 'Short summary explaining what the tool is for.'
      }),
      progressive_guidance: Type.Optional(
        Type.String({
          minLength: 8,
          maxLength: PROGRESSIVE_GUIDANCE_MAX_LENGTH,
          description:
            'Operational guidance shown to the agent only after this tool is loaded.'
        })
      ),
      icon_name: Type.Optional(
        Type.String({
          minLength: 1,
          pattern: REMIX_ICON_NAME_PATTERN,
          description:
            'Icon name from https://remixicon.com. Filled icons ending with "-fill" are not allowed.'
        })
      ),
      author: Type.Composite([toolAuthorSchemaObject], {
        description: 'Author information for this tool.'
      }),
      binaries: Type.Optional(
        Type.Record(
          Type.String({
            minLength: 1,
            description: 'Platform identifier for a downloadable binary.'
          }),
          Type.String({
            minLength: 1,
            description: 'Download URL for the platform-specific binary.'
          }),
          {
            description: 'Map of platform identifiers to binary download URLs.'
          }
        )
      ),
      resources: Type.Optional(
        Type.Record(
          Type.String({
            minLength: 1,
            description: 'Logical resource group name.'
          }),
          Type.Array(
            Type.String({
              minLength: 1,
              description: 'Download URL for a required resource file.'
            }),
            {
              description: 'List of resource URLs for the given resource group.'
            }
          ),
          {
            description: 'Map of resource groups to resource download URLs.'
          }
        )
      ),
      connection: Type.Optional(toolConnectionSchemaObject),
      functions: Type.Record(
        Type.String({
          minLength: 1,
          description: 'Function name exposed by the tool runtime.'
        }),
        toolFunctionSchemaObject,
        {
          description: 'Map of callable function names to their definitions.'
        }
      )
    },
    {
      description: 'Schema for a Leon tool manifest.'
    }
  )
)

export type ToolManifestSchema = Static<typeof toolManifestSchemaObject>
