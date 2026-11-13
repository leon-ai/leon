import fs from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { CODEBASE_PATH, resolveToolDirectory } from '@/leon-roots'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { FileHelper } from '@/helpers/file-helper'
import type { ToolManifestSchema } from '@/schemas/tool-schemas'
import type { MCPFunction, MCPManifest, MCPSource } from '../tool-source'
import { getMCPURL } from './http'

const MAXIMUM_CACHE_BYTES = 4 * 1_024 * 1_024
const CACHE_FILE = '.mcp-tools.json'
const INITIAL_TOOL_VERSION = '1.0.0'

interface MCPDiscoveryCache {
  source: MCPSource
  functions: Record<string, MCPFunction>
  requiresAuth: boolean
}

/**
 * Uses bounded, last-known discovery locally; reading a manifest never connects.
 */
export function readMCPCache(directory: string, source: MCPSource): MCPDiscoveryCache | undefined {
  const filename = path.join(directory, CACHE_FILE)
  try {
    if (statSync(filename).size > MAXIMUM_CACHE_BYTES) {
      return undefined
    }
    const cache = JSON.parse(readFileSync(filename, 'utf8')) as MCPDiscoveryCache
    if (!cache || typeof cache.requiresAuth !== 'boolean' || !cache.functions ||
      typeof cache.functions !== 'object' || Array.isArray(cache.functions) ||
      Object.keys(cache.functions).length > 256 || Object.values(cache.functions).some((entry) =>
        !entry || typeof entry.remote_name !== 'string' || typeof entry.description !== 'string' ||
        !entry.parameters || typeof entry.parameters !== 'object' || Array.isArray(entry.parameters))) {
      return undefined
    }

    return JSON.stringify(cache.source) === JSON.stringify(source) ? cache : undefined
  } catch {
    return undefined
  }
}

/**
 * Stores remote schemas independently from the owner's editable server definition.
 */
export async function saveMCPCache(manifest: MCPManifest, functions: Record<string, MCPFunction>, requiresAuth: boolean): Promise<void> {
  const directory = resolveToolDirectory(getProfilePaths().tools, manifest.toolkit_id, manifest.tool_id)
  const installed = JSON.parse(await fs.readFile(path.join(directory, 'tool.json'), 'utf8')) as MCPManifest
  if (JSON.stringify(installed.source) !== JSON.stringify(manifest.source)) {
    return
  }
  const cache: MCPDiscoveryCache = { source: manifest.source, functions, requiresAuth }
  if (Buffer.byteLength(JSON.stringify(cache)) > MAXIMUM_CACHE_BYTES) {
    throw new Error('This MCP catalog is too large.')
  }
  await FileHelper.writeAtomicJSON(path.join(directory, CACHE_FILE), cache)
}

/**
 * Materializes only owner-selected catalog entries; custom servers receive
 * independent IDs and cannot shadow native tools or another installation.
 */
export async function installMCP(input: { catalogId?: string, name?: string, url?: string, clientId?: string, clientMetadataUrl?: string }): Promise<string> {
  let catalog: Readonly<ToolManifestSchema> | undefined
  if (input.catalogId) {
    const { BUNDLED_TOOL_CATALOG } = await import('../catalog/catalog-loader')
    catalog = (await BUNDLED_TOOL_CATALOG.list()).find(({ manifest }) =>
      `${manifest.toolkit_id}.${manifest.tool_id}` === input.catalogId)?.manifest
    if (!catalog?.source) {
      throw new Error('This catalog entry is not available.')
    }
  }
  const url = getMCPURL(catalog?.source?.url ?? input.url ?? '')
  const toolkitId = catalog?.toolkit_id ?? 'mcp'
  const toolId = catalog?.tool_id ?? `server-${randomUUID().slice(0, 8)}`
  const directory = resolveToolDirectory(getProfilePaths().tools, toolkitId, toolId)
  const filename = path.join(directory, 'tool.json')
  if (existsSync(filename)) {
    throw new Error('This MCP server is already installed.')
  }
  const clientId = input.clientId ?? catalog?.source?.clientId
  const clientMetadataUrl = input.clientMetadataUrl ?? catalog?.source?.clientMetadataUrl
  const source: MCPSource = { type: 'mcp', transport: 'http', url: url.toString(),
    ...(clientId ? { clientId } : {}),
    ...(clientMetadataUrl ? { clientMetadataUrl: getMCPURL(clientMetadataUrl).toString() } : {}) }
  if (source.clientMetadataUrl && new URL(source.clientMetadataUrl).protocol !== 'https:') {
    throw new Error('Client metadata documents require a public HTTPS URL.')
  }
  const manifest = {
    $schema: path.join(CODEBASE_PATH, 'schemas', 'tool-schemas', 'tool.json'),
    tool_id: toolId, toolkit_id: toolkitId,
    name: catalog?.name ?? (input.name?.trim() || url.hostname),
    version: catalog?.version ?? INITIAL_TOOL_VERSION,
    description: catalog?.description ?? 'Tools provided by an owner-installed MCP server.',
    icon_name: catalog?.icon_name ?? 'plug-line', author: catalog?.author ?? { name: 'MCP server' },
    distribution: 'extension',
    ...(catalog?.maintainers ? { maintainers: catalog.maintainers } : {}),
    ...(catalog?.logo ? { logo: catalog.logo } : {}),
    ...(catalog?.logo_mask ? { logo_mask: catalog.logo_mask } : {}),
    source, functions: {}
  }
  // The profile's toolkit manifest lists installations, never catalog suggestions.
  // Write it first: a failed tool write is harmless and the operation can be retried.
  const toolkitFile = path.join(getProfilePaths().tools, toolkitId, 'toolkit.json')
  const existing = existsSync(toolkitFile) ? JSON.parse(await fs.readFile(toolkitFile, 'utf8')) as {
    name: string
    description: string
    icon_name: string
    tools: string[]
  } : { name: 'MCP servers',
    description: 'Tools added to this profile.', icon_name: 'plug-line', tools: [] }
  await FileHelper.writeAtomicJSON(toolkitFile, { ...existing, tools: [...new Set([...existing.tools, toolId])] })
  await FileHelper.writeAtomicJSON(filename, manifest, { exclusive: true })

  return `${toolkitId}.${toolId}`
}
