import { MAX_GENERATED_ARTIFACT_BYTES } from '@/constants'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'

import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { registerArtifact } from '@/core/artifacts/artifact-store'
import { attachArtifacts } from '@/core/artifacts/artifact-service'

/**
 * Accepts bounded binary uploads from authenticated clients and Satellites.
 */
export const uploadArtifacts: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.addContentTypeParser(
    'application/octet-stream',
    (_request, payload, done) => done(null, payload)
  )
  fastify.post<{
    Params: { sessionId: string }
    Querystring: { filename: string, mime_type: string, attach?: boolean }
    Body: Readable
  }>(
    `/api/${options.apiVersion}/artifacts/:sessionId`,
    {
      bodyLimit: MAX_GENERATED_ARTIFACT_BYTES,
      schema: {
        querystring: Type.Object({
          filename: Type.String({ minLength: 1, maxLength: 255 }),
          mime_type: Type.String({ minLength: 1, maxLength: 255 }),
          attach: Type.Optional(Type.Boolean())
        })
      }
    },
    async (request, reply) => {
      const { sessionId } = request.params

      if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
        return reply
          .code(404)
          .send({ error: 'Conversation session not found.' })
      }

      const root = path.join(
        getSatelliteArtifactRoot(getActiveProfileName(), sessionId),
        'uploads'
      )

      await fs.promises.mkdir(root, { recursive: true })
      const temporary = await fs.promises.mkdtemp(path.join(root, 'upload-'))
      const filename = path.join(temporary, 'content')
      let bytes = 0

      try {
        await pipeline(
          request.body,
          new Transform({
            transform(chunk: Buffer, _encoding, callback): void {
              bytes += chunk.length
              callback(
                bytes > MAX_GENERATED_ARTIFACT_BYTES
                  ? new Error('Artifact upload exceeds the size limit.')
                  : null,
                chunk
              )
            }
          }),
          fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 })
        )
        const artifact = await registerArtifact({
          session_id: sessionId,
          path: filename,
          filename: request.query.filename,
          mime_type: request.query.mime_type,
          source: 'upload'
        })

        if (request.query.attach !== false) {
          await attachArtifacts(sessionId, [artifact.id])
        }

        return reply.code(201).send(artifact)
      } finally {
        await fs.promises.rm(temporary, { recursive: true, force: true })
      }
    }
  )
}
