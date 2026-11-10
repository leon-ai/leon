import fs from 'node:fs/promises'
import path from 'node:path'

import { TOOLS_PATH } from '@/constants'
import type { ToolManifestSchema } from '@/schemas/tool-schemas'
import { getMCPURL } from '../mcp/http'

const MAXIMUM_MANIFEST_BYTES = 1_024 * 1_024

export interface BundledToolDefinition {
  manifest: Readonly<ToolManifestSchema>
  directory: string
}

/**
 * Reads canonical tool manifests once, without installing dependencies, opening
 * transports or discovering remote functions. Failed snapshots remain retryable.
 */
export class BundledToolCatalog {
  private pending: Promise<readonly BundledToolDefinition[]> | undefined

  public constructor(private readonly directory = TOOLS_PATH) {}

  public list(): Promise<readonly BundledToolDefinition[]> {
    if (!this.pending) {
      this.pending = this.read().catch((error) => {
        this.pending = undefined
        throw error
      })
    }

    return this.pending
  }

  private async read(): Promise<readonly BundledToolDefinition[]> {
    const [{ ajv }, { toolCatalogSchemaObject }] = await Promise.all([
      import('@/ajv'), import('@/schemas/tool-schemas')
    ])
    const validate = ajv.compile<ToolManifestSchema>(toolCatalogSchemaObject)
    const entries: BundledToolDefinition[] = []
    const identities = new Set<string>()
    const toolkits = await fs.readdir(this.directory, { withFileTypes: true })

    // Sequential reads bound open files even with hundreds of integrations.
    for (const toolkit of toolkits.filter((entry) => entry.isDirectory())) {
      const toolkitPath = path.join(this.directory, toolkit.name)
      for (const tool of await fs.readdir(toolkitPath, { withFileTypes: true })) {
        if (!tool.isDirectory()) {
          continue
        }
        const directory = path.join(toolkitPath, tool.name)
        const filename = path.join(directory, 'tool.json')
        const stat = await fs.stat(filename).catch(() => undefined)
        if (!stat) {
          continue
        }
        try {
          if (stat.size > MAXIMUM_MANIFEST_BYTES) {
            throw new Error('Manifest exceeds the metadata size limit.')
          }
          const manifest: unknown = JSON.parse(await fs.readFile(filename, 'utf8'))
          if (!validate(manifest)) {
            throw new Error(ajv.errorsText(validate.errors))
          }
          if (manifest.toolkit_id !== toolkit.name || manifest.tool_id !== tool.name) {
            throw new Error('Manifest identity must match its toolkit/tool directory.')
          }
          for (const toolId of [manifest.tool_id, ...manifest.previous_tool_ids ?? []]) {
            const id = `${manifest.toolkit_id}.${toolId}`
            if (identities.has(id)) {
              throw new Error('Catalog identities and previous IDs must be unique.')
            }
            identities.add(id)
          }
          if (!manifest.functions || typeof manifest.functions !== 'object' || Array.isArray(manifest.functions)) {
            throw new Error('Tool functions must be an object.')
          }
          if (manifest.source) {
            if (Object.keys(manifest).some((key) => key !== 'functions' && !Object.hasOwn(toolCatalogSchemaObject.properties, key))) {
              throw new Error('MCP definitions contain only catalog metadata and a server source.')
            }
            getMCPURL(manifest.source.url)
            if (manifest.distribution !== 'extension' || Object.keys(manifest.functions).length) {
              throw new Error('Bundled MCP definitions must be extensions without remote schemas.')
            }
            if (manifest.source.clientMetadataUrl && getMCPURL(manifest.source.clientMetadataUrl).protocol !== 'https:') {
              throw new Error('Client metadata documents require HTTPS.')
            }
          }
          // Browsing retains metadata, not a second copy of every native schema.
          // The execution registry reads functions from their owning manifests.
          entries.push(Object.freeze({ manifest: Object.freeze({ ...manifest, functions: {} }), directory }))
        } catch (error) {
          throw new Error(`Invalid tool catalog entry "${toolkit.name}/${tool.name}". ${error instanceof Error ? error.message : 'Could not read metadata.'}`)
        }
      }
    }

    return Object.freeze(entries)
  }
}

export const BUNDLED_TOOL_CATALOG = new BundledToolCatalog()
