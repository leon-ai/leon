import fs from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { requireBinaryUpload } from '@/core/http-server/binary-upload'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { registerArtifact } from '@/core/artifacts/artifact-store'
import type { Artifact } from '@/core/artifacts/artifact-types'
import { validateOwnerAttachmentContent } from '@/core/owner-attachment-validation'
import {
  OWNER_ATTACHMENT_SOURCE, OWNER_ATTACHMENT_MAX_FILE_BYTES, getOwnerAttachmentFormat, getOwnerAttachmentSizeLimit
} from '@/core/owner-attachment-contract'

/**
 * Stores validated owner uploads through the immutable, profile-scoped artifact
 * store. Binary bodies bypass JSON buffering; message commands carry IDs only.
 */
export const ownerAttachmentRoutes: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  fastify.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))
  fastify.post<{
    Params: { session_id: string }
    Querystring: { filename: string, media_type: string }
    Body: Readable
  }>(`/api/${options.apiVersion}/sessions/:session_id/attachments`, {
    bodyLimit: OWNER_ATTACHMENT_MAX_FILE_BYTES,
    onRequest: requireBinaryUpload,
    schema: {
      params: Type.Object({ session_id: Type.String({ format: 'uuid' }) }),
      querystring: Type.Object({
        filename: Type.String({ minLength: 1, maxLength: 255 }),
        media_type: Type.String({ minLength: 1, maxLength: 255 })
      })
    }
  }, async (request, reply) => {
    const sessionId = request.params.session_id
    if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      return reply.code(404).send({ message: 'Session not found.' })
    }
    const { filename, media_type: mediaType } = request.query
    const format = getOwnerAttachmentFormat(filename, mediaType)
    if (!format) {
      return reply.code(400).send({ message: 'This attachment filename or file type is not supported.' })
    }
    const limit = getOwnerAttachmentSizeLimit(format)
    const declaredSize = Number(request.headers['content-length'])
    if (declaredSize > limit) {
      return reply.code(413).send({ message: `This file exceeds its ${limit / 1_024 / 1_024} MB attachment limit.` })
    }
    const root = path.join(getProfilePaths().sessions, encodeURIComponent(sessionId), 'attachments')
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = await fs.mkdtemp(path.join(root, 'upload-'))
    const destination = path.join(temporary, 'content')
    let bytes = 0
    let attachment: Artifact | undefined
    let failure: unknown
    try {
      const output = await fs.open(destination, 'wx', 0o600)
      try {
        // Returning early must not destroy the incoming HTTP socket: the owner
        // still needs the actionable size error. Each write supplies backpressure.
        for await (const chunk of request.body.iterator({ destroyOnReturn: false })) {
          bytes += chunk.length
          if (bytes > limit) {
            throw new Error('This file exceeds its attachment size limit.')
          }
          await output.writeFile(chunk)
        }
      } finally {
        await output.close()
      }
      if (!bytes) {
        throw new Error('Empty files cannot be attached.')
      }
      await validateOwnerAttachmentContent(destination, format.mediaType)
      if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
        throw new Error('This session was deleted before the upload completed.')
      }
      attachment = await registerArtifact({
        session_id: sessionId, path: destination, filename,
        mime_type: format.mediaType, source: OWNER_ATTACHMENT_SOURCE
      })
    } catch (error) {
      failure = error
    } finally {
      request.body.resume()
      await fs.rm(temporary, { recursive: true, force: true })
    }
    if (failure) {
      return reply.code(bytes > limit ? 413 : 400).send({
        message: failure instanceof Error ? failure.message : 'I could not upload this file.'
      })
    }

    return reply.code(201).send({ attachment })
  })
}
