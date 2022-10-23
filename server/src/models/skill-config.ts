import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const skillActionTypes = [Type.Literal('logic'), Type.Literal('dialog')]

export const skillDataTypes = [
  Type.Literal('skill_resolver'),
  Type.Literal('global_resolver'),
  Type.Literal('entity')
]

export const skillConfigSchema = {
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

export const skillConfigSchemaObject = Type.Strict(
  Type.Object(skillConfigSchema, { additionalProperties: false })
)

export type SkillConfig = Static<typeof skillConfigSchemaObject>
