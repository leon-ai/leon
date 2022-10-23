import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const skillBridges = [Type.Literal('python')]

export const skillSchema = {
  name: Type.String({ minLength: 1 }),
  bridge: Type.Union(skillBridges),
  version: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  author: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1, maxLength: 254, format: 'email' }),
    url: Type.String({ minLength: 1, maxLength: 255, format: 'uri' })
  })
}

export const skillSchemaObject = Type.Strict(
  Type.Object(skillSchema, { additionalProperties: false })
)

export type SkillBridge = Static<typeof skillSchema.bridge>
export type Skill = Static<typeof skillSchemaObject>
