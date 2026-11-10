import type { CatalogMetadata } from '../../schemas/catalog-metadata-schemas'

export interface CatalogPresentation extends Partial<CatalogMetadata> {
  documents?: { readme: boolean, changelog: boolean }
  logoUrl?: string
}

export interface SkillCatalogEntry extends CatalogPresentation {
  id: string
  name: string
  description: string
  iconName: string
  kind: 'native' | 'agent'
  version: string
  installed: boolean
  enabled: boolean
  owned: boolean
}

export interface CatalogDocument {
  text: string
}
