import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

import {
  PROGRESSIVE_GUIDANCE_MAX_LENGTH,
  REMIX_ICON_NAME_PATTERN
} from '@/constants'

export const toolkitSchemaObject = Type.Strict(
  Type.Object({
    $schema: Type.String({
      minLength: 1,
      description: 'Path or URL to the JSON Schema used by editors for this toolkit manifest.'
    }),
    name: Type.String({
      minLength: 1,
      description: 'Display name for the group of related tools.'
    }),
    description: Type.String({
      minLength: 8,
      maxLength: 256,
      description: 'Summary of the capabilities the toolkit groups together.'
    }),
    progressive_guidance: Type.Optional(
      Type.String({
        minLength: 8,
        maxLength: PROGRESSIVE_GUIDANCE_MAX_LENGTH,
        description:
          'Operational guidance shown to the agent only after this toolkit is loaded.'
      })
    ),
    icon_name: Type.String({
      minLength: 1,
      pattern: REMIX_ICON_NAME_PATTERN,
      description:
        'Icon name from https://remixicon.com. Filled icons ending with "-fill" are not allowed.'
    }),
    context_files: Type.Array(
      Type.String({
        minLength: 1,
        pattern: '^[A-Z0-9_]+\\.md$'
      }),
      {
        description: 'Names of context files Leon can summarize for the agent when it loads this toolkit.'
      }
    ),
    tools: Type.Array(Type.String({ minLength: 1 }), {
      description: 'Tool IDs to load from this toolkit, matching their tool directory names.'
    })
  })
)

export type ToolkitSchema = Static<typeof toolkitSchemaObject>
