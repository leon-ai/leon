import type { Static } from '@sinclair/typebox'
import { Type } from '@sinclair/typebox'

export const domainSchema = {
  name: Type.String({ minLength: 1 })
}

export const domainSchemaObject = Type.Strict(
  Type.Object(domainSchema, { additionalProperties: false })
)

export type Domain = Static<typeof domainSchemaObject>
