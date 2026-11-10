import { Type, type Static } from '@sinclair/typebox'
import { LogoMaskMode } from '../../../aurora/src/contracts/package-logo'

export enum CatalogDistribution {
  BuiltIn = 'built-in',
  Extension = 'extension'
}

export enum CatalogMaintenance {
  Official = 'official',
  Community = 'community'
}

export const catalogContactSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
  url: Type.Optional(Type.String({ format: 'uri', maxLength: 2_048 })),
  github: Type.Optional(Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$' })),
  discord: Type.Optional(Type.Object({
    id: Type.Optional(Type.String({ pattern: '^[0-9]{17,20}$' })),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  }, {
    additionalProperties: false,
    anyOf: [{ required: ['id'] }, { required: ['username'] }]
  }))
}, { additionalProperties: false })

// Compose these raw properties before Type.Strict removes optional markers.
export const catalogMetadataProperties = {
  author: catalogContactSchema,
  maintainers: Type.Optional(Type.Array(catalogContactSchema, { maxItems: 32 })),
  distribution: Type.Optional(Type.Enum(CatalogDistribution)),
  maintenance: Type.Optional(Type.Enum(CatalogMaintenance)),
  logo: Type.Optional(Type.Literal('logo.svg')),
  logo_mask: Type.Optional(Type.Enum(LogoMaskMode, {
    description: 'Optional monochrome activity glyph: alpha preserves transparent silhouettes; inverse-luminance removes white fills from black-and-white artwork.'
  }))
}

export const catalogMetadataSchema = Type.Strict(Type.Object(catalogMetadataProperties, {
  additionalProperties: false
}))

export type CatalogContact = Static<typeof catalogContactSchema>
export type CatalogMetadata = Static<typeof catalogMetadataSchema>
