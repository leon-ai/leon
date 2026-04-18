import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

import { REMIX_ICON_NAME_PATTERN } from '@/constants'

const toolAuthorSchemaObject = Type.Strict(
  Type.Object({
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
  }, {
    description: 'Author metadata for the tool manifest.'
  })
)

const toolFunctionSchemaObject = Type.Strict(
  Type.Object({
    description: Type.String({
      minLength: 8,
      maxLength: 256,
      description: 'Human-readable description of what the function does.'
    }),
    parameters: Type.Object(
      {},
      {
        additionalProperties: true,
        description: 'JSON Schema describing the accepted function parameters.'
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
    hooks: Type.Optional(
      Type.Strict(
        Type.Object({
          post_execution: Type.Optional(
            Type.Strict(
              Type.Object({
                response_jq: Type.Optional(
                  Type.String({
                    minLength: 1,
                    description:
                      'Default jq filter applied to the executor output after the function runs.'
                  })
                )
              }, {
                description:
                  'Post-execution hook configuration for executor-side output shaping.'
              })
            )
          )
        }, {
          description: 'Internal function hooks used by the runtime, not by the model.'
        })
      )
    )
  }, {
    description: 'Schema for a single callable function exposed by a tool.'
  })
)

export const toolManifestSchemaObject = Type.Strict(
  Type.Object({
    $schema: Type.String({
      minLength: 1,
      description: 'Path or URL to the JSON schema used to validate this manifest.'
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
    description: Type.String({
      minLength: 8,
      maxLength: 272,
      description: 'Short summary explaining what the tool is for.'
    }),
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
  }, {
    description: 'Schema for a Leon tool manifest.'
  })
)

export type ToolManifestSchema = Static<typeof toolManifestSchemaObject>
