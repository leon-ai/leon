import { Type, type Static } from '@sinclair/typebox'

import { REMIX_ICON_NAME_PATTERN } from '@/constants'
import { SkillFormat } from '@/types'
import { catalogMetadataProperties } from './catalog-metadata-schemas'

// Agent manifests describe the package, not native bridge actions. SKILL.md
// remains authoritative for the portable skill name, description and workflow.
export const agentSkillSchemaObject = Type.Strict(Type.Object({
  $schema: Type.Optional(Type.String({
    minLength: 1,
    description: 'Path or URL to the JSON Schema used by editors for this package manifest.'
  })),
  format: Type.Literal(SkillFormat.AgentSkill, {
    description: 'Identifies an Agent Skill package whose discovery metadata and workflow live in SKILL.md.'
  }),
  ...catalogMetadataProperties,
  version: Type.Optional(Type.String({
    minLength: 1,
    description: 'Semantic version of the Agent Skill package.'
  })),
  icon_name: Type.Optional(Type.String({
    pattern: REMIX_ICON_NAME_PATTERN,
    description: 'Remix Icon line icon used to represent the skill in Leon interfaces.'
  }))
}, { additionalProperties: false }))

export type AgentSkillManifest = Static<typeof agentSkillSchemaObject>
