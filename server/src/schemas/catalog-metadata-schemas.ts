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
  name: Type.String({
    minLength: 1,
    maxLength: 128,
    description: 'Display name of the person or organization.'
  }),
  email: Type.Optional(Type.String({
    format: 'email',
    maxLength: 254,
    description: 'Public email address for contacting this person or organization.'
  })),
  url: Type.Optional(Type.String({
    format: 'uri',
    maxLength: 2_048,
    description: 'Website or public profile URL for this person or organization.'
  })),
  github: Type.Optional(Type.String({
    pattern: '^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$',
    description: 'GitHub account or organization name used to link to its profile.'
  })),
  discord: Type.Optional(Type.Object({
    id: Type.Optional(Type.String({
      pattern: '^[0-9]{17,20}$',
      description: 'Numeric Discord user ID as a string, used to link to the account.'
    })),
    username: Type.Optional(Type.String({
      minLength: 1,
      maxLength: 80,
      description: 'Public Discord username for display or lookup.'
    }))
  }, {
    additionalProperties: false,
    anyOf: [{ required: ['id'] }, { required: ['username'] }],
    description: 'Discord contact with a user ID, a username, or both.'
  }))
}, { additionalProperties: false })

// Compose these raw properties before Type.Strict removes optional markers.
export const catalogMetadataProperties = {
  author: Type.Object(catalogContactSchema.properties, {
    additionalProperties: false,
    description: 'Original author credited for creating the package.'
  }),
  maintainers: Type.Optional(Type.Array(catalogContactSchema, {
    maxItems: 32,
    description: 'People or organizations currently responsible for maintaining the package or integration.'
  })),
  distribution: Type.Optional(Type.Enum(CatalogDistribution, {
    description:
      'How the package is offered. Built-in packages are included by default. Extensions require explicit installation in each profile, even when their source ships with Leon.'
  })),
  maintenance: Type.Optional(Type.Enum(CatalogMaintenance, {
    description:
      'Who maintains the package or integration. Official identifies Leon-maintained entries curated by the project. Community identifies entries maintained by community contributors.'
  })),
  logo: Type.Optional(Type.Literal('logo.svg', {
    description: 'Package-local SVG used as the image in catalog and connection cards.'
  })),
  logo_mask: Type.Optional(Type.Enum(LogoMaskMode, {
    description: 'Optional monochrome activity glyph: alpha preserves transparent silhouettes; inverse-luminance removes white fills from black-and-white artwork.'
  }))
}

export const catalogMetadataSchema = Type.Strict(Type.Object(catalogMetadataProperties, {
  additionalProperties: false
}))

export type CatalogContact = Static<typeof catalogContactSchema>
export type CatalogMetadata = Static<typeof catalogMetadataSchema>
