import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const globalEntity = {
  options: Type.Record(
    Type.String(),
    Type.Object({
      synonyms: Type.Array(Type.String()),
      data: Type.Record(Type.String(), Type.Array(Type.String()))
    })
  )
}

export const globalEntitySchemaObject = Type.Strict(
  Type.Object(globalEntity, { additionalProperties: false })
)

export type GlobalEntity = Static<typeof globalEntitySchemaObject>
