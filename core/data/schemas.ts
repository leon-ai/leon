import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

const globalEntity = {
  options: Type.Record(
    Type.String(),
    Type.Object({
      synonyms: Type.Array(Type.String()),
      data: Type.Record(Type.String(), Type.Array(Type.String()))
    })
  )
}
const globalResolver = {
  name: Type.String(),
  intents: Type.Record(
    Type.String(),
    Type.Object({
      utterance_samples: Type.Array(Type.String()),
      value: Type.Unknown()
    })
  )
}
const answers = {
  answers: Type.Record(
    Type.String(),
    Type.Union([
      Type.Record(Type.String(), Type.String()),
      Type.Array(Type.String())
    ])
  )
}

const globalEntitySchemaObject = Type.Strict(
  Type.Object(globalEntity, { additionalProperties: false })
)
const globalResolverSchemaObject = Type.Strict(
  Type.Object(globalResolver, { additionalProperties: false })
)
const answersSchemaObject = Type.Strict(
  Type.Object(answers, { additionalProperties: false })
)

export type GlobalEntity = Static<typeof globalEntitySchemaObject>
export type GlobalResolver = Static<typeof globalResolverSchemaObject>
export type Answers = Static<typeof answersSchemaObject>
