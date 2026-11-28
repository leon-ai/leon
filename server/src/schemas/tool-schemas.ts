import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'
import { ToolCompletionReview, ToolConcurrency } from '@/types'
import { MAX_TOOL_TIMEOUT_MS } from '@@/bridges/runtime/contracts/tool-runtime-types'
import { ToolExecutionTarget } from '@@/bridges/runtime/contracts/device-execution'
import { catalogMetadataProperties } from './catalog-metadata-schemas'

import {
  PROGRESSIVE_GUIDANCE_MAX_LENGTH,
  REMIX_ICON_NAME_PATTERN
} from '@/constants'

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
            'Block repeated successful inputs until an operation may change the observed state. Disable for reads that can change independently over time.'
        })
      ),
      read_only: Type.Optional(
        Type.Boolean({
          description:
            'Whether this function leaves observed state unchanged. Undeclared functions invalidate reuse of prior observations, including failures after partial execution.'
        })
      ),
      background: Type.Optional(
        Type.Boolean({
          description:
            'Allow agent calls to yield a retained execution handle after a bounded wait. Execution keeps its original deadline and can be waited on, queried or canceled.'
        })
      ),
      device_allowed: Type.Optional(Type.Boolean({
        description: 'Set false to keep this function out of paired device execution.'
      })),
      timeout: Type.Optional(
        Type.Object({
          idleMs: Type.Optional(Type.Integer({
            minimum: 1,
            maximum: MAX_TOOL_TIMEOUT_MS,
            description: 'Maximum milliseconds the call may go without output or advancing progress.'
          })),
          totalMs: Type.Optional(Type.Integer({
            minimum: 1,
            maximum: MAX_TOOL_TIMEOUT_MS,
            description: 'Maximum elapsed milliseconds for the call, even while it is making progress.'
          }))
        }, {
          additionalProperties: false,
          minProperties: 1,
          description: 'Execution limits in milliseconds. Actual output or advancing progress renews idleMs; totalMs is optional and never renewed. Task deadlines still apply.'
        })
      ),
      completion_review: Type.Optional(
        Type.Enum(ToolCompletionReview, {
          description:
            'Required by default. Optional is only for complete, low-risk read-only lookups; the agent still reviews plans, failures, recovery, partial or retained results and multiple calls.'
        })
      ),
      concurrency: Type.Optional(
        Type.Enum(ToolConcurrency, {
          description:
            'Override tool-level concurrency for this function. Parallel uses isolated workers; serial retains shared instance state.'
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
  authorization_url: Type.String({
    format: 'uri',
    description: 'Provider endpoint where the owner signs in and grants access.'
  }),
  token_url: Type.String({
    format: 'uri',
    description: 'Provider endpoint for exchanging the authorization code and refreshing tokens.'
  }),
  scopes: Type.Array(Type.String(), {
    description: 'OAuth permissions Leon requests from the provider when connecting the account.'
  }),
  uses_pkce: Type.Optional(Type.Boolean({
    description: 'Whether to bind the authorization request and code exchange using an S256 PKCE challenge.'
  })),
  token_auth: Type.Union([
    Type.Literal('basic'),
    Type.Literal('body'),
    Type.Literal('none')
  ], {
    description: 'Token endpoint client authentication. Use HTTP Basic, send credentials in the request body, or send only the client ID for a public client.'
  }),
  token_format: Type.Union([Type.Literal('json'), Type.Literal('form')], {
    description: 'Encoding of the token request body, either JSON or URL-encoded form data.'
  }),
  authorization_parameters: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Extra provider-specific query parameters for the authorization request.'
    })
  ),
  token_parameters: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Extra provider-specific body fields for token exchange and refresh requests.'
    })
  ),
  supports_refresh: Type.Boolean({
    description: 'Whether Leon can use a stored refresh token to request a new access token.'
  })
})

const toolConnectionMethodSchemaObject = Type.Object({
  name: Type.String({
    minLength: 1,
    description: 'Display name of this connection method.'
  }),
  description: Type.String({
    minLength: 1,
    description: 'Owner-facing explanation of what this connection method does.'
  }),
  setup_url: Type.String({
    format: 'uri',
    description: 'Provider page where the owner can issue credentials or register an application.'
  }),
  setup: Type.Optional(
    Type.Object({
      instructions: Type.Array(Type.String({ minLength: 1 }), {
        description: 'Ordered steps the owner follows to configure the provider.'
      }),
      values: Type.Record(Type.String(), Type.String(), {
        description: 'Labeled values the owner can copy into the provider setup form.'
      })
    }, {
      description: 'Guidance and copyable application details shown during connection setup.'
    })
  ),
  settings: Type.Record(Type.String(), Type.Union([Type.Null(), Type.String()]), {
    description: 'Connection setup fields and their defaults. A null default means the owner must supply a value, as in settings.sample.json.'
  })
})

export const toolConnectionSchemaObject = Type.Object({
  required_settings: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: 'Credential keys that must be present in the saved connection before the tool can run.'
  }),
  methods: Type.Object({
    api_key: Type.Optional(Type.Object(toolConnectionMethodSchemaObject.properties, {
      description: 'Setup for credentials the owner supplies directly, such as an API key.'
    })),
    oauth: Type.Optional(
      Type.Composite([toolConnectionMethodSchemaObject, toolOAuthSchemaObject], {
        description: 'Setup and protocol settings for connecting an account through OAuth.'
      })
    )
  }, {
    description: 'Connection methods the owner can choose from when setting up the tool.'
  })
}, {
  description: 'Account connection requirements and setup methods for this tool.'
})

export type ToolConnectionSchema = Static<typeof toolConnectionSchemaObject>

export type ToolOAuthSchema = Static<typeof toolOAuthSchemaObject>

const toolManifestObject = Type.Object(
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
    previous_tool_ids: Type.Optional(Type.Array(
      Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9][a-z0-9_-]*$' }),
      {
        maxItems: 32,
        uniqueItems: true,
        description: 'Former tool IDs recognized as aliases so existing installations and authorizations keep working after a rename.'
      }
    )),
    toolkit_id: Type.String({
      minLength: 1,
      description: 'Identifier of the toolkit that owns this tool.'
    }),
    name: Type.String({
      minLength: 1,
      description: 'Human-readable tool name shown in interfaces.'
    }),
    version: Type.String({
      minLength: 1,
      description: 'Version following semver.'
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
    ...catalogMetadataProperties,
    execution_target: Type.Optional(Type.Enum(ToolExecutionTarget, {
      description: 'Host required by the tool. Omit to use the profile’s existing routing.'
    })),
    binaries: Type.Optional(
      Type.Record(
        Type.String({
          minLength: 1,
          description: 'Platform identifier for a downloadable binary.'
        }),
        Type.Union([
          Type.String({
            minLength: 1,
            description: 'Download URL for the platform-specific binary.'
          }),
          Type.Object({
            url: Type.String({
              minLength: 1,
              description: 'Download URL for the platform-specific binary or archive.'
            }),
            executable: Type.Optional(Type.String({
              minLength: 1,
              description: 'Relative archive entrypoint. Preserves the entire extracted bundle.'
            })),
            sha256: Type.Optional(Type.String({
              pattern: '^[a-fA-F0-9]{64}$',
              description: 'Expected SHA-256 of the downloaded asset, verified before extraction.'
            }))
          }, { additionalProperties: false })
        ]),
        {
          description: 'Map of platform identifiers to managed binary sources.'
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
    source: Type.Optional(Type.Object({
      type: Type.Literal('mcp', {
        description: 'Identifies a Model Context Protocol server as the source of the tool functions.'
      }),
      transport: Type.Literal('http', {
        description: 'Transport Leon uses to communicate with the remote MCP server.'
      }),
      url: Type.String({
        format: 'uri',
        description: 'MCP HTTP endpoint used to connect and discover callable functions.'
      }),
      clientId: Type.Optional(Type.String({
        minLength: 1,
        description: 'Pre-registered OAuth client ID Leon can use to authorize this MCP connection.'
      })),
      clientMetadataUrl: Type.Optional(Type.String({
        format: 'uri',
        description: 'HTTPS URL of an OAuth client metadata document for authorization servers that support it.'
      }))
    }, {
      additionalProperties: false,
      description: 'Remote MCP server definition. Leon discovers its functions after profile installation, so the manifest declares an empty functions map.'
    })),
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
    description: 'Schema for a Leon tool manifest.',
    additionalProperties: false
  }
)

export const toolManifestSchemaObject = Type.Strict(toolManifestObject)

// Catalog discovery validates presentation and identity without interpreting
// function schemas or loading executable guidance into the browsing layer.
export const toolCatalogSchemaObject = Type.Strict(Type.Object({
  ...Type.Pick(toolManifestObject, [
    '$schema', 'tool_id', 'previous_tool_ids', 'toolkit_id', 'name', 'description', 'icon_name',
    'author', 'maintainers', 'distribution', 'maintenance', 'logo', 'logo_mask', 'source'
  ]).properties,
  // Owner-installed tools remain discoverable without authored release metadata.
  version: Type.Optional(toolManifestObject.properties.version)
}, { additionalProperties: true }))

export type ToolManifestSchema = Static<typeof toolManifestSchemaObject>
