import type { FastifyInstance } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONFIG_MANAGER } from '@/config'

import { createHTTPPluginLeonServices } from './leon-services'
import { loadExternalHTTPPlugins } from './loader'
import type {
  DiscoveredHTTPPluginDefinition,
  HTTPPluginRuntimeConfig
} from './types'

function normalizePluginId(pluginId: string): string {
  return pluginId.trim().replaceAll('_', '-')
}

function resolveHTTPPluginRuntimeConfig(
  pluginId: string
): HTTPPluginRuntimeConfig {
  const config = CONFIG_MANAGER.getConfig().http_plugins
  const normalizedPluginId = normalizePluginId(pluginId)
  const pluginConfigs = config.plugins as Record<
    string,
    { enabled: boolean, root_routes: boolean } | undefined
  >
  const pluginConfig =
    pluginConfigs[pluginId] ||
    pluginConfigs[normalizedPluginId] ||
    pluginConfigs[normalizedPluginId.replaceAll('-', '_')]

  return {
    enabled: config.enabled && Boolean(pluginConfig?.enabled),
    allowRootRoutes:
      config.allow_root_routes && Boolean(pluginConfig?.root_routes),
    auth: {
      enabled: config.auth.enabled,
      token: CONFIG_MANAGER.resolveSecretReference(config.auth.token)
    }
  }
}

export class HTTPPluginManager {
  public constructor(
    private pluginDefinitions: DiscoveredHTTPPluginDefinition[] = []
  ) {}

  public async loadPlugins(): Promise<void> {
    const pluginsById = new Map<string, DiscoveredHTTPPluginDefinition>()

    for (const plugin of await loadExternalHTTPPlugins()) {
      pluginsById.set(plugin.definition.id, plugin)
    }

    this.pluginDefinitions = Array.from(pluginsById.values())
  }

  public getPluginStates(): Array<{
    id: string
    name: string
    version: string
    description: string
    source: string
    path?: string
    enabled: boolean
    root_routes: boolean
  }> {
    return this.pluginDefinitions.map((plugin) => {
      const runtimeConfig = resolveHTTPPluginRuntimeConfig(plugin.definition.id)
      const state = {
        id: plugin.definition.id,
        name: plugin.definition.name,
        version: plugin.definition.version,
        description: plugin.definition.description,
        source: plugin.source,
        enabled: runtimeConfig.enabled,
        root_routes: runtimeConfig.allowRootRoutes
      }

      if (plugin.path) {
        return {
          ...state,
          path: plugin.path
        }
      }

      return state
    })
  }

  public async register(
    fastify: FastifyInstance,
    options: APIOptions
  ): Promise<void> {
    this.registerStatusRoute(fastify, options)
    const leon = createHTTPPluginLeonServices()

    for (const plugin of this.pluginDefinitions) {
      const runtimeConfig = resolveHTTPPluginRuntimeConfig(plugin.definition.id)

      if (!runtimeConfig.enabled) {
        continue
      }

      await plugin.definition.register(fastify, {
        ...options,
        plugin: runtimeConfig,
        leon
      })
    }
  }

  private registerStatusRoute(
    fastify: FastifyInstance,
    options: APIOptions
  ): void {
    fastify.route({
      method: 'GET',
      url: `/api/${options.apiVersion}/http-plugins`,
      handler: async (_request, reply) => {
        reply.send({
          success: true,
          status: 200,
          code: 'http_plugins_listed',
          message: 'HTTP plugins listed.',
          plugins: this.getPluginStates()
        })
      }
    })
  }
}

export async function registerHTTPPlugins(
  fastify: FastifyInstance,
  options: APIOptions
): Promise<void> {
  const manager = new HTTPPluginManager()

  await manager.loadPlugins()
  await manager.register(fastify, options)
}
