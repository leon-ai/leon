import type { CatalogPresentation } from '../catalog/types'
import type { CatalogMetadata } from '../../schemas/catalog-metadata-schemas'

export interface MCPSource {
  type: 'mcp'
  transport: 'http'
  url: string
  clientId?: string
  clientMetadataUrl?: string
}

export interface MCPFunction {
  description: string
  parameters: Record<string, unknown>
  output_schema?: Record<string, unknown>
  remote_name: string
}

export interface MCPManifest extends Partial<CatalogMetadata> {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  icon_name: string
  source: MCPSource
  functions: Record<string, MCPFunction>
}

export interface ToolCatalogEntry extends CatalogPresentation {
  id: string
  catalogId?: string
  name: string
  description: string
  iconName: string
  kind: 'native' | 'mcp'
  installed: boolean
  enabled: boolean
  connected: boolean
  canConnect: boolean
  connectionMethod?: string
  toolCount?: number
  url?: string
  owned?: boolean
}

export enum CatalogToolState {
  NotAdded = 'not_added',
  Disabled = 'disabled',
  NeedsConnection = 'needs_connection',
  Ready = 'ready'
}
