import type { FastifyInstance } from 'fastify'

import { readCatalogDocument, readCatalogAsset } from '@/core/catalog/presentation'

interface CatalogPackage {
  directory: string
  logo?: string
}

/**
 * Shares bounded, authenticated document/image delivery across catalog types.
 * Cached images vary by every accepted credential so profiles cannot share them.
 */
export function registerCatalogAssets(fastify: FastifyInstance, base: string, resolve: (id: string) => Promise<CatalogPackage | undefined>): void {
  fastify.get<{ Params: { id: string, document: string } }>(`${base}/:id/documents/:document`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      const entry = await resolve(request.params.id)
      if (!entry) {
        throw new Error('Unknown package.')
      }

      return await readCatalogDocument(entry.directory, request.params.document, `${base}/${encodeURIComponent(request.params.id)}`)
    } catch {
      return reply.code(404).send({ message: 'This document is not available.' })
    }
  })
  fastify.get<{ Params: { id: string, '*': string } }>(`${base}/:id/assets/*`, async (request, reply) => {
    try {
      const entry = await resolve(request.params.id)
      if (!entry) {
        throw new Error('Unknown package.')
      }
      const asset = await readCatalogAsset(entry.directory, request.params['*'], entry.logo)

      return reply.header('Cache-Control', 'private, max-age=300')
        .header('Vary', 'Cookie, Authorization, X-Leon-Profile-Token')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox')
        .type(asset.type).send(asset.body)
    } catch {
      return reply.code(404).send({ message: 'This image is not available.' })
    }
  })
}
