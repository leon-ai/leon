import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

const skillBridges = [Type.Literal('python'), Type.Null()]
const skillActionTypes = [Type.Literal('logic'), Type.Literal('dialog')]
const skillDataTypes = [
  Type.Literal('skill_resolver'),
  Type.Literal('global_resolver'),
  Type.Literal('entity')
]
const skillCustomEntityTypes = [
  Type.Array(
    Type.Object({
      type: Type.Literal('trim'),
      name: Type.String({ minLength: 1 }),
      conditions: Type.Array(
        Type.Object({
          type: Type.Union([
            Type.Literal('between'),
            Type.Literal('after'),
            Type.Literal('after_first'),
            Type.Literal('after_last'),
            Type.Literal('before'),
            Type.Literal('before_first'),
            Type.Literal('before_last')
          ]),
          from: Type.Optional(
            Type.Union([
              Type.Array(Type.String({ minLength: 1 })),
              Type.String({ minLength: 1 })
            ])
          ),
          to: Type.Optional(
            Type.Union([
              Type.Array(Type.String({ minLength: 1 })),
              Type.String({ minLength: 1 })
            ])
          )
        })
      )
    })
  ),
  Type.Array(
    Type.Object({
      type: Type.Literal('regex'),
      name: Type.String({ minLength: 1 }),
      regex: Type.String({ minLength: 1 })
    })
  ),
  Type.Array(
    Type.Object({
      type: Type.Literal('enum'),
      name: Type.String(),
      options: Type.Record(
        Type.String({ minLength: 1 }),
        Type.Object({
          synonyms: Type.Array(Type.String({ minLength: 1 }))
        })
      )
    })
  )
]

export const domainSchemaObject = Type.Object({
  name: Type.String({ minLength: 1 })
})
export const skillSchemaObject = Type.Object({
  name: Type.String({ minLength: 1 }),
  bridge: Type.Union(skillBridges),
  version: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  author: Type.Object({
    name: Type.String({ minLength: 1 }),
    email: Type.Optional(Type.String({ minLength: 1, maxLength: 254 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 255 }))
  })
})
export const skillConfigSchemaObject = Type.Object({
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
      entities: Type.Optional(Type.Union(skillCustomEntityTypes)),
      next_action: Type.Optional(Type.String())
    })
  ),
  answers: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  entities: Type.Optional(Type.Record(Type.String(), Type.String()))
})

export type Domain = Static<typeof domainSchemaObject>
export type Skill = Static<typeof skillSchemaObject>
export type SkillConfig = Static<typeof skillConfigSchemaObject>
export type SkillBridge = Static<typeof skillSchemaObject.bridge>
