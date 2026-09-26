import fs from 'node:fs'
import { uploadArtifacts } from './upload'
import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { readArtifact } from '@/core/artifacts/artifact-store'

const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/
const INLINE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'application/pdf'
])

/**
 * Profile authentication runs before these routes; only registered IDs are served.
 */
export const artifactsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(uploadArtifacts, options)
  fastify.get<{
    Params: { sessionId: string, id: string }
    Querystring: { download?: boolean }
  }>(
    `/api/${options.apiVersion}/artifacts/:sessionId/:id`,
    {
      schema: {
        querystring: Type.Object({ download: Type.Optional(Type.Boolean()) })
      }
    },
    async (request, reply) => {
      let resolved: Awaited<ReturnType<typeof readArtifact>>

      try {
        resolved = await readArtifact(
          request.params.sessionId,
          request.params.id
        )
      } catch {
        return reply.code(404).send({ error: 'Artifact not found.' })
      }

      const { artifact, path: filename } = resolved
      // SVG/HTML and other active content are downloads, never same-origin documents.
      const inline = INLINE_MEDIA_TYPES.has(artifact.mime_type)

      reply
        .header('Content-Type', artifact.mime_type)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', 'sandbox; default-src \'none\'')
        .header('Cache-Control', 'private, no-store')
        .header('Accept-Ranges', 'bytes')
        .header(
          'Content-Disposition',
          `${inline && !request.query.download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`
        )
      let start = 0
      let end = artifact.size_bytes - 1
      const range = request.headers.range

      if (range) {
        const match = BYTE_RANGE_PATTERN.exec(range)

        if (!match || (!match[1] && !match[2])) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${artifact.size_bytes}`)
            .send()
        }

        start = match[1]
          ? Number(match[1])
          : Math.max(0, artifact.size_bytes - Number(match[2]))
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start < 0
        ) {
          return reply
            .code(416)
            .header('Content-Range', `bytes */${artifact.size_bytes}`)
            .send()
        }

        reply
          .code(206)
          .header(
            'Content-Range',
            `bytes ${start}-${end}/${artifact.size_bytes}`
          )
      }

      reply.header('Content-Length', Math.max(0, end - start + 1))

      return reply.send(
        artifact.size_bytes
          ? fs.createReadStream(filename, { start, end })
          : Buffer.alloc(0)
      )
    }
  )
}
