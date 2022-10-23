import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const globalResolver = {
  name: Type.String(),
  intents: Type.Record(
    Type.String(),
    Type.Object({
      utterance_samples: Type.Array(Type.String()),
      value: Type.Unknown()
    })
  )
}

export const globalResolverSchemaObject = Type.Strict(
  Type.Object(globalResolver, { additionalProperties: false })
)

export type GlobalResolver = Static<typeof globalResolverSchemaObject>
