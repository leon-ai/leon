import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const globalEntitySchemaObject = Type.Strict(
  Type.Object(
    {
      options: Type.Record(
        Type.String(),
        Type.Object(
          {
            synonyms: Type.Array(Type.String()),
            data: Type.Optional(
              Type.Record(Type.String(), Type.Array(Type.String()))
            )
          },
          { additionalProperties: false }
        )
      )
    },
    {
      description:
        'Global entities can hold data that can directly be reused in skills.'
    }
  )
)
export const globalResolverSchemaObject = Type.Strict(
  Type.Object({
    name: Type.String(),
    intents: Type.Record(
      Type.String(),
      Type.Object(
        {
          utterance_samples: Type.Array(Type.String()),
          value: Type.Unknown()
        },
        { additionalProperties: false }
      )
    )
  })
)
export const globalAnswersSchemaObject = Type.Strict(
  Type.Object({
    answers: Type.Record(
      Type.String(),
      Type.Union([
        Type.Record(Type.String(), Type.String()),
        Type.Array(Type.String())
      ])
    )
  })
)

export type GlobalEntitySchema = Static<typeof globalEntitySchemaObject>
export type GlobalResolverSchema = Static<typeof globalResolverSchemaObject>
export type GlobalAnswersSchema = Static<typeof globalAnswersSchemaObject>
