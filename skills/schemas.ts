import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

const domainSchema = {
  name: Type.String({ minLength: 1 })
}
const skillBridges = [Type.Literal('python')]
const skillSchema = {
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
const skillActionTypes = [Type.Literal('logic'), Type.Literal('dialog')]
const skillDataTypes = [
  Type.Literal('skill_resolver'),
  Type.Literal('global_resolver'),
  Type.Literal('entity')
]
const skillConfigSchema = {
  variables: Type.Optional(Type.Record(Type.String(), Type.String())),
  actions: Type.Record(
    Type.String(),
    Type.Object({
      type: Type.Union(skillActionTypes),
      loop: Type.Optional(
        Type.Object({
          expected_item: Type.Object({
            type: Type.Union(skillDataTypes),
            name: Type.String()
          })
        })
      ),
      utterance_samples: Type.Optional(Type.Array(Type.String())),
      answers: Type.Optional(Type.Array(Type.String())),
      unknown_answers: Type.Optional(Type.Array(Type.String())),
      suggestions: Type.Optional(Type.Array(Type.String())),
      slots: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String(),
            item: Type.Object({
              type: Type.Union(skillDataTypes),
              name: Type.String()
            }),
            questions: Type.Array(Type.String()),
            suggestions: Type.Optional(Type.Array(Type.String()))
          })
        )
      ),
      entities: Type.Optional(
        Type.Array(
          Type.Object({
            type: Type.Literal('enum'),
            name: Type.String(),
            options: Type.Record(
              Type.String(),
              Type.Object({
                synonyms: Type.Array(Type.String())
              })
            )
          })
        )
      ),
      next_action: Type.Optional(Type.String())
    })
  ),
  answers: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  entities: Type.Optional(Type.Record(Type.String(), Type.String()))
}

const domainSchemaObject = Type.Strict(
  Type.Object(domainSchema, { additionalProperties: false })
)
const skillSchemaObject = Type.Strict(
  Type.Object(skillSchema, { additionalProperties: false })
)
const skillConfigSchemaObject = Type.Strict(
  Type.Object(skillConfigSchema, { additionalProperties: false })
)

export type Domain = Static<typeof domainSchemaObject>
export type Skill = Static<typeof skillSchemaObject>
export type SkillConfig = Static<typeof skillConfigSchemaObject>
export type SkillBridge = Static<typeof skillSchema.bridge>
