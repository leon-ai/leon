import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { UPDATE_SERVICE, type UpdateService } from '@/core/ota/update-service'
import { LEON_UPDATE_EXIT_CODE } from '@@/bridges/runtime/contracts/updates'
import { requestShutdown } from '@/core/server-lifecycle'

/**
 * Uses the normal profile authentication boundary for host update actions.
 */
export const updatesPlugin: FastifyPluginAsync<APIOptions & { service?: UpdateService }> = async (fastify, options) => {
  const service = options.service ?? UPDATE_SERVICE
  const base = `/api/${options.apiVersion}/updates`
  fastify.get(base, async () => service.snapshot())
  fastify.post(`${base}/check`, async () => {
    await service.check()

    return service.snapshot()
  })
  fastify.post<{ Body: { tag: string } }>(`${base}/apply`, {
    schema: { body: Type.Object({ tag: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }) }
  }, async (request, reply) => {
    try {
      const snapshot = await service.prepare(request.body.tag)
      const delivered = new Promise<void>((resolve) => {
        reply.raw.once('finish', resolve)
        reply.raw.once('close', resolve)
      })
      void delivered.then(() => service.waitUntilPrepared()).then(() => requestShutdown(LEON_UPDATE_EXIT_CODE)).catch(() => {
        // Staging failures stay visible in the update receipt; keep the server alive
        // so the owner can inspect the error and retry.
      })

      return reply.code(202).send(snapshot)
    } catch (error) {
      return reply.code(409).send({ message: error instanceof Error ? error.message : String(error) })
    }
  })
}
