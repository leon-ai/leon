import { Type, type Static } from '@sinclair/typebox'

import { REMIX_ICON_NAME_PATTERN } from '@/constants'
import { SkillFormat } from '@/types'
import { catalogMetadataProperties } from './catalog-metadata-schemas'

// Agent manifests describe the package, not native bridge actions. SKILL.md
// remains authoritative for the portable skill name, description and workflow.
export const agentSkillSchemaObject = Type.Strict(Type.Object({
  $schema: Type.Optional(Type.String({ minLength: 1 })),
  format: Type.Literal(SkillFormat.AgentSkill),
  ...catalogMetadataProperties,
  version: Type.Optional(Type.String({ minLength: 1 })),
  icon_name: Type.Optional(Type.String({ pattern: REMIX_ICON_NAME_PATTERN }))
}, { additionalProperties: false }))

export type AgentSkillManifest = Static<typeof agentSkillSchemaObject>
