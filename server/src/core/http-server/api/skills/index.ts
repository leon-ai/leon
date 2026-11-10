import type { FastifyPluginAsync } from 'fastify'
import type { APIOptions } from '@/core/http-server/http-server'
import { SKILL_CATALOG } from '@/core/catalog/skills'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { registerCatalogAssets } from '../catalog-assets'

/**
 * Lists and manages skills within the authenticated profile, retaining their
 * existing discovery and execution formats.
 */
export const skillsPlugin: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const base = `/api/${options.apiVersion}/skills`
  fastify.get(`${base}/catalog`, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')

    return { skills: await SKILL_CATALOG.list() }
  })
  fastify.post<{ Params: { id: string }, Body: { action: 'install' | 'enable' | 'disable' | 'remove' } }>(`${base}/:id`, {
    schema: { body: { type: 'object', additionalProperties: false, required: ['action'],
      properties: { action: { type: 'string', enum: ['install', 'enable', 'disable', 'remove'] } } } }
  }, async (request, reply) => {
    try {
      await SKILL_CATALOG.act(request.params.id, request.body.action)

      return { success: true }
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : 'I could not update this skill.' })
    }
  })
  registerCatalogAssets(fastify, base, async (id) => {
    const descriptor = SkillDomainHelper.getSkillDescriptorSync(id, { includeDisabled: true })
    if (!descriptor) {
      return undefined
    }
    const logo = descriptor.catalog?.logo

    return { directory: descriptor.path, ...(logo ? { logo } : {}) }
  })
}
