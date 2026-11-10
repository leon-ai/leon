import type { FastifyPluginAsync } from 'fastify'
import type { APIOptions } from '@/core/http-server/http-server'
import { TOOL_CATALOG, toolDefinitions } from '@/core/tool-manager/catalog/catalog'
import { registerCatalogAssets } from '../catalog-assets'
import { completeMCPOAuth } from '@/core/tool-manager/mcp/manager'

/**
 * Exposes profile-scoped installation metadata and explicit owner mutations.
 * Read routes never perform server discovery or return saved credentials.
 */
export const toolsPlugin: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const base = `/api/${options.apiVersion}/tools`
  fastify.get(`${base}/catalog`, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')

    return { tools: await TOOL_CATALOG.list() }
  })
  registerCatalogAssets(fastify, base, async (id) => {
    const entry = (await toolDefinitions()).find(({ manifest }) => `${manifest.toolkit_id}.${manifest.tool_id}` === id)
    if (!entry) {
      return undefined
    }
    const logo = (entry.presentation?.manifest ?? entry.manifest).logo

    return { directory: entry.presentation?.directory ?? entry.directory, ...(logo ? { logo } : {}) }
  })
  fastify.post<{ Body: { catalogId?: string, name?: string, url?: string, clientId?: string, clientMetadataUrl?: string } }>(
    base, { schema: { body: {
      type: 'object', additionalProperties: false,
      properties: {
        catalogId: { type: 'string', maxLength: 128 }, name: { type: 'string', minLength: 1, maxLength: 80 },
        url: { type: 'string', format: 'uri', maxLength: 2_048 },
        clientId: { type: 'string', minLength: 1, maxLength: 256 },
        clientMetadataUrl: { type: 'string', format: 'uri', maxLength: 2_048 }
      }, anyOf: [{ required: ['catalogId'] }, { required: ['url'] }]
    } } }, async (request, reply) => {
      try {
        return reply.code(201).send({ id: await TOOL_CATALOG.install(request.body) })
      } catch {
        return reply.code(400).send({ message: 'I could not add this tool. Check whether it is already installed. For custom servers, use HTTPS or HTTP on loopback only.' })
      }
    }
  )
  fastify.post<{ Params: { id: string }, Body: { action: 'enable' | 'disable' | 'disconnect' | 'remove' } }>(
    `${base}/:id`, { schema: { body: { type: 'object', additionalProperties: false, required: ['action'],
      properties: { action: { type: 'string', enum: ['enable', 'disable', 'disconnect', 'remove'] } } } } }, async (request, reply) => {
      try {
        await TOOL_CATALOG.act(request.params.id, request.body.action)

        return { success: true }
      } catch (error) {
        return reply.code(400).send({ message: error instanceof Error ? error.message : 'I could not update this tool.' })
      }
    }
  )
  // State, not browser identity or query profile names, owns the callback.
  fastify.get<{ Querystring: Record<string, string> }>(`${base}/oauth/callback`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    const target = await completeMCPOAuth(new URLSearchParams(request.query))

    return target ? reply.redirect(target) : reply.code(400).send({ message: 'This sign-in expired. Start again from Leon.' })
  })
}
