import fs from 'node:fs/promises'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { CONNECTION_STORE, ConnectionStatus } from '@/core/connections/connection-store'
import { ProfileHelper } from '@/helpers/profile-helper'
import { TOOLKIT_REGISTRY } from '@/core'
import { CatalogDistribution } from '@/schemas/catalog-metadata-schemas'
import type { ToolManifestSchema } from '@/schemas/tool-schemas'
import { catalogPresentation } from '@/core/catalog/presentation'
import { isCatalogInstalled, setCatalogInstalled } from '@/core/catalog/activation'
import { MCP_CONNECTIONS } from '../mcp/auth'
import { installMCP, readMCPCache } from '../mcp/installations'
import { FileHelper } from '@/helpers/file-helper'
import { MCP_MANAGER } from '../mcp/manager'
import { getMCPURL } from '../mcp/http'
import { BUNDLED_TOOL_CATALOG, type BundledToolDefinition } from './catalog-loader'
import type { MCPManifest, ToolCatalogEntry } from '../tool-source'
import { getPreferredConnectionMethod } from '@@/aurora/src/contracts/connection-setup'

const MAXIMUM_MANIFEST_BYTES = 1_024 * 1_024

export interface CatalogToolDefinition {
  manifest: Readonly<ToolManifestSchema>
  directory: string
  owned: boolean
  installed: boolean
  presentation?: BundledToolDefinition
}

/**
 * Overlays installed owner manifests on canonical bundled definitions. Catalog
 * suggestions never enter the runtime registry merely because their source exists.
 */
export async function toolDefinitions(): Promise<CatalogToolDefinition[]> {
  const entries = new Map<string, CatalogToolDefinition>()
  const previous = new Map<string, BundledToolDefinition>()
  const replaced = new Set<string>()

  for (const { manifest, directory } of await BUNDLED_TOOL_CATALOG.list()) {
    const id = `${manifest.toolkit_id}.${manifest.tool_id}`
    entries.set(id, {
      manifest,
      directory,
      owned: false,
      installed: !manifest.source && isCatalogInstalled(
        manifest.distribution,
        path.join(getProfilePaths().tools, manifest.toolkit_id, manifest.tool_id)
      )
    })
    for (const previousId of manifest.previous_tool_ids ?? []) {
      previous.set(`${manifest.toolkit_id}.${previousId}`, { manifest, directory })
    }
  }
  const root = getProfilePaths().tools
  for (const toolkit of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!toolkit.isDirectory()) {
      continue
    }
    const toolkitConfig = await fs.readFile(path.join(root, toolkit.name, 'toolkit.json'), 'utf8')
      .then(JSON.parse).catch(() => undefined) as { tools?: string[] } | undefined
    if (!Array.isArray(toolkitConfig?.tools)) {
      continue
    }
    const registered = new Set(toolkitConfig.tools)
    for (const tool of await fs.readdir(path.join(root, toolkit.name), { withFileTypes: true })) {
      if (!tool.isDirectory() || !registered.has(tool.name)) {
        continue
      }
      const directory = path.join(root, toolkit.name, tool.name)
      try {
        const filename = path.join(directory, 'tool.json')
        if ((await fs.stat(filename)).size > MAXIMUM_MANIFEST_BYTES) {
          continue
        }
        const { ajv } = await import('@/ajv')
        const { toolCatalogSchemaObject } = await import('@/schemas/tool-schemas')
        const manifest: unknown = JSON.parse(await fs.readFile(filename, 'utf8'))
        if (!ajv.validate(toolCatalogSchemaObject, manifest)) {
          continue
        }
        const definition = manifest as ToolManifestSchema
        if (definition.toolkit_id !== toolkit.name || definition.tool_id !== tool.name) {
          continue
        }
        if (!definition.functions || typeof definition.functions !== 'object' || Array.isArray(definition.functions)) {
          continue
        }
        if (definition.source) {
          getMCPURL(definition.source.url)
        }
        const id = `${toolkit.name}.${tool.name}`
        const bundled = entries.get(id) ?? previous.get(id)
        // Profile-specific OAuth application settings do not change the catalog
        // publisher. A different server URL must lose curated branding/trust.
        const presentation = definition.source && bundled?.manifest.source?.url === definition.source.url
          ? { manifest: bundled.manifest, directory: bundled.directory } : undefined
        if (presentation && previous.has(id)) {
          // Keep installed IDs and encrypted grants stable. Renaming a bundled
          // definition must not rewrite history or require another authorization.
          replaced.add(`${presentation.manifest.toolkit_id}.${presentation.manifest.tool_id}`)
        }
        entries.set(id, {
          manifest: definition,
          directory,
          owned: true,
          installed: true,
          ...(presentation ? { presentation } : {})
        })
      } catch {
        // A broken owner package must not hide the rest of the catalog.
      }
    }
  }

  for (const id of replaced) {
    if (!entries.get(id)?.owned) {
      entries.delete(id)
    }
  }

  return [...entries.values()]
}

/**
 * Resolves only explicit profile installations, never bundled suggestions.
 */
export async function getInstalledMCP(id: string): Promise<MCPManifest | undefined> {
  const entry = (await toolDefinitions()).find(({ manifest, owned }) => owned &&
    manifest.source?.type === 'mcp' && `${manifest.toolkit_id}.${manifest.tool_id}` === id)

  return entry?.manifest as MCPManifest | undefined
}

/**
 * Serializes profile installation and availability changes independently of the
 * transport. Reading this catalog never contacts a provider or runs an installer.
 */
export class ToolCatalog {
  private mutations: Promise<unknown> = Promise.resolve()

  /**
   * Combines local presentation and safe connection summaries without discovery.
   */
  public async list(): Promise<ToolCatalogEntry[]> {
    const nativeConnections = await CONNECTION_STORE.list()
    const remoteConnections = await MCP_CONNECTIONS.list()
    const entries: ToolCatalogEntry[] = []
    for (const { manifest, directory, owned, installed, presentation } of await toolDefinitions()) {
      const id = `${manifest.toolkit_id}.${manifest.tool_id}`
      const kind = manifest.source ? 'mcp' : 'native'
      const cache = manifest.source && installed ? readMCPCache(directory, manifest.source) : undefined
      const connected = installed && (kind === 'mcp'
        ? Boolean(cache && (!cache.requiresAuth || remoteConnections.some((entry) => entry.provider === id && entry.status === ConnectionStatus.Connected)))
        : nativeConnections.some((entry) => entry.provider === id && entry.status === ConnectionStatus.Connected))
      const connectionMethod = manifest.source ? 'oauth' : manifest.connection
        ? getPreferredConnectionMethod(Object.keys(manifest.connection.methods).map((id) => ({ id })))?.id : undefined
      entries.push({
        id,
        ...(!owned && !installed ? { catalogId: id } : {}),
        name: manifest.name,
        description: manifest.description,
        iconName: manifest.icon_name ?? 'tools-line',
        kind,
        installed,
        owned,
        enabled: installed && !ProfileHelper.isToolDisabled(manifest.tool_id, manifest.toolkit_id),
        connected,
        canConnect: kind === 'mcp' || Boolean(manifest.connection),
        ...(connectionMethod ? { connectionMethod } : {}),
        ...(cache ? { toolCount: Object.keys(cache.functions).length } : {}),
        ...(manifest.source ? { url: manifest.source.url } : {}),
        ...await catalogPresentation(
          presentation?.manifest ?? manifest,
          presentation?.directory ?? directory,
          !owned || Boolean(presentation),
          `tools/${encodeURIComponent(id)}`
        )
      })
    }

    return entries.sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }

  /**
   * A rejected operation cannot block subsequent profile changes.
   */
  public change<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutations.catch(() => undefined).then(operation)
    this.mutations = pending

    return pending
  }

  /**
   * Publishes native activation or a profile-owned MCP definition only after its
   * prerequisite setup succeeds, without granting account access.
   */
  public async install(input: Parameters<typeof installMCP>[0]): Promise<string> {
    return this.change(async () => {
      const entry = input.catalogId ? (await toolDefinitions()).find(({ manifest }) =>
        `${manifest.toolkit_id}.${manifest.tool_id}` === input.catalogId) : undefined
      if (input.catalogId && (!entry || entry.installed)) {
        throw new Error('This tool is unavailable or already installed.')
      }
      let id: string
      if (entry && !entry.manifest.source) {
        id = input.catalogId!
        const { prepareNativeSource } = await import('@/core/catalog/prepare-native')
        const { ToolSettings } = await import('../tool-settings')
        await prepareNativeSource(entry.directory)
        ToolSettings.loadToolSettings(entry.manifest.toolkit_id, entry.manifest.tool_id, {}, true)
        await setCatalogInstalled(path.join(getProfilePaths().tools, entry.manifest.toolkit_id, entry.manifest.tool_id), true)
      } else {
        id = await installMCP(input)
      }
      await TOOLKIT_REGISTRY.reload()

      return id
    })
  }

  /**
   * Separates availability and authorization from uninstalling managed state;
   * owner-created source and settings are never deleted.
   */
  public async act(id: string, action: 'enable' | 'disable' | 'disconnect' | 'remove'): Promise<void> {
    return this.change(async () => {
      const entry = (await toolDefinitions()).find(({ manifest }) => `${manifest.toolkit_id}.${manifest.tool_id}` === id)
      if (!entry?.installed) {
        throw new Error('This tool is not installed.')
      }
      if (action === 'enable' || action === 'disable') {
        if (ProfileHelper.hasToolAllowlist()) {
          throw new Error('This profile uses an allow-only list. Update that list with /tool before changing this tool.')
        }
        if (action === 'enable') {
          await ProfileHelper.enableTool(id)
        } else {
          await ProfileHelper.disableTool(id)
          await MCP_MANAGER.close(id)
        }
      } else if (action === 'disconnect') {
        await MCP_MANAGER.close(id)
        if (entry.manifest.source) {
          await MCP_CONNECTIONS.remove(id)
          await fs.unlink(path.join(entry.directory, '.mcp-tools.json')).catch(() => undefined)
        } else {
          await CONNECTION_STORE.remove(id)
        }
      } else if (!entry.owned && entry.manifest.distribution === CatalogDistribution.Extension && !entry.manifest.source) {
        await setCatalogInstalled(path.join(getProfilePaths().tools, entry.manifest.toolkit_id, entry.manifest.tool_id), false)
      } else {
        if (!entry.owned || !entry.manifest.source) {
          throw new Error('Disable this tool instead. Only installed extensions can be removed here.')
        }
        await MCP_MANAGER.close(id)
        await MCP_CONNECTIONS.remove(id)
        const toolkitFile = path.join(path.dirname(entry.directory), 'toolkit.json')
        const toolkit = JSON.parse(await fs.readFile(toolkitFile, 'utf8')) as { tools: string[] }
        await FileHelper.writeAtomicJSON(toolkitFile, { ...toolkit, tools: toolkit.tools.filter((tool) => tool !== entry.manifest.tool_id) })
        // Remove managed files only, retaining owner settings and source files.
        await fs.unlink(path.join(entry.directory, 'tool.json'))
        await fs.unlink(path.join(entry.directory, '.mcp-tools.json')).catch(() => undefined)
        await fs.rmdir(entry.directory).catch(() => undefined)
      }
      await TOOLKIT_REGISTRY.reload()
      if (action !== 'enable') {
        // Close attempts that began while manifest/config writes were pending.
        await MCP_MANAGER.close(id)
      }
    })
  }
}

export const TOOL_CATALOG = createProfileServiceProxy('TOOL_CATALOG', () => new ToolCatalog())
