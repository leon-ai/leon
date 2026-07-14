import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import YAML from 'yaml'

import { LogHelper } from '@/helpers/log-helper'
import { LEON_HOME_PATH } from '@/leon-roots'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'

import type {
  DiscoveredHTTPPluginDefinition,
  HTTPPluginDefinition,
  HTTPPluginManifest,
  HTTPPluginSourceScope
} from './types'

const HTTP_PLUGINS_DIRECTORY_NAME = 'http-plugins'
const MANIFEST_FILENAME = 'plugin.yml'

export interface HTTPPluginSearchRoot {
  scope: Extract<HTTPPluginSourceScope, 'global' | 'profile'>
  directory: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePluginId(pluginId: string): string {
  return pluginId.trim().replaceAll('_', '-')
}

function isHTTPPluginDefinition(value: unknown): value is HTTPPluginDefinition {
  if (!isRecord(value)) {
    return false
  }

  return (
    Boolean(asString(value['id'])) &&
    Boolean(asString(value['name'])) &&
    Boolean(asString(value['version'])) &&
    Boolean(asString(value['description'])) &&
    typeof value['register'] === 'function'
  )
}

function parseManifest(raw: string): HTTPPluginManifest {
  const parsed = YAML.parse(raw)

  if (!isRecord(parsed)) {
    throw new Error('Plugin manifest must be an object.')
  }

  const id = asString(parsed['id'])
  if (!id) {
    throw new Error('Plugin manifest must define a non-empty id.')
  }

  const manifest: HTTPPluginManifest = { id }
  const name = asString(parsed['name'])
  const version = asString(parsed['version'])
  const description = asString(parsed['description'])
  const entry = asString(parsed['entry'])

  if (name) {
    manifest.name = name
  }
  if (version) {
    manifest.version = version
  }
  if (description) {
    manifest.description = description
  }
  if (entry) {
    manifest.entry = entry
  }

  return manifest
}

function findManifestPath(pluginDirectory: string): string {
  const manifestPath = path.join(pluginDirectory, MANIFEST_FILENAME)

  if (fs.existsSync(manifestPath)) {
    return manifestPath
  }

  throw new Error(`Missing plugin manifest (${MANIFEST_FILENAME}).`)
}

function resolveEntryPath(pluginDirectory: string, manifest: HTTPPluginManifest): string {
  const entry = manifest.entry || 'index.js'
  const entryPath = path.resolve(pluginDirectory, entry)
  const relativeEntryPath = path.relative(pluginDirectory, entryPath)

  if (
    relativeEntryPath.startsWith('..') ||
    path.isAbsolute(relativeEntryPath)
  ) {
    throw new Error('Plugin entry must stay inside the plugin directory.')
  }

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Plugin entry does not exist: ${entry}`)
  }

  return entryPath
}

async function loadHTTPPluginFromDirectory(
  pluginDirectory: string,
  source: HTTPPluginSearchRoot['scope']
): Promise<DiscoveredHTTPPluginDefinition> {
  const manifestPath = findManifestPath(pluginDirectory)
  const manifest = parseManifest(await fs.promises.readFile(manifestPath, 'utf8'))
  const entryPath = resolveEntryPath(pluginDirectory, manifest)
  const module = await import(pathToFileURL(entryPath).href)
  const exportedDefinition = module.default || module.httpPlugin || module.plugin

  if (!isHTTPPluginDefinition(exportedDefinition)) {
    throw new Error(
      'Plugin entry must export a default HTTPPluginDefinition, httpPlugin, or plugin.'
    )
  }

  const definition: HTTPPluginDefinition = {
    ...exportedDefinition,
    id: normalizePluginId(manifest.id),
    name: manifest.name || exportedDefinition.name,
    version: manifest.version || exportedDefinition.version,
    description: manifest.description || exportedDefinition.description
  }

  return {
    definition,
    source,
    path: pluginDirectory
  }
}

export function getDefaultHTTPPluginSearchRoots(): HTTPPluginSearchRoot[] {
  return [
    {
      scope: 'global',
      directory: path.join(LEON_HOME_PATH, HTTP_PLUGINS_DIRECTORY_NAME)
    },
    {
      scope: 'profile',
      directory: path.join(getProfilePaths().root, HTTP_PLUGINS_DIRECTORY_NAME)
    }
  ]
}

export async function loadExternalHTTPPlugins(
  searchRoots: HTTPPluginSearchRoot[] = getDefaultHTTPPluginSearchRoots()
): Promise<DiscoveredHTTPPluginDefinition[]> {
  const pluginsById = new Map<string, DiscoveredHTTPPluginDefinition>()

  for (const root of searchRoots) {
    if (!fs.existsSync(root.directory)) {
      continue
    }

    const entries = await fs.promises.readdir(root.directory, {
      withFileTypes: true
    })

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const pluginDirectory = path.join(root.directory, entry.name)

      try {
        const plugin = await loadHTTPPluginFromDirectory(
          pluginDirectory,
          root.scope
        )

        pluginsById.set(plugin.definition.id, plugin)
      } catch (error) {
        LogHelper.title('HTTP Plugins')
        LogHelper.warning(
          `Failed to load HTTP plugin at "${pluginDirectory}": ${String(error)}`
        )
      }
    }
  }

  return Array.from(pluginsById.values())
}
