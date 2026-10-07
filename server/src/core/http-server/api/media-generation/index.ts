import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  generateMedia,
  getMediaGeneration,
  listMediaCapabilities,
  listMediaDefaults,
  saveGenerationSettings
} from '@/core/llm-manager/media-generation/media-generation-service'
import {
  MediaKind,
  type MediaGenerationInput
} from '@/core/llm-manager/media-generation/media-generation-types'
import type { GenerationSettings } from '@/core/llm-manager/media-generation/media-generation-settings'
import { LLMProviders } from '@/core/llm-manager/types'

/**
 * Shared generation surface for tools and authenticated third-party clients.
 */
export const mediaGenerationPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  const root = `/api/${options.apiVersion}/media-generation`

  fastify.get<{ Querystring: { session_id?: string } }>(
    root,
    {
      schema: {
        querystring: Type.Object({ session_id: Type.Optional(Type.String()) })
      }
    },
    async (request) => ({
      providers: await listMediaCapabilities(),
      defaults: await listMediaDefaults(request.query.session_id)
    })
  )
  fastify.post<{ Params: { kind: MediaKind }, Body: GenerationSettings }>(
    `${root}/:kind/settings`,
    {
      schema: {
        params: Type.Object({ kind: Type.Enum(MediaKind) }),
        body: Type.Object(
          {
            provider: Type.Union([
              Type.Enum(LLMProviders),
              Type.Literal('inherit')
            ]),
            model: Type.String({ minLength: 1 }),
            options: Type.Record(Type.String(), Type.Unknown())
          },
          { additionalProperties: false }
        )
      }
    },
    async (request) => saveGenerationSettings(request.params.kind, request.body)
  )
  fastify.post<{ Body: MediaGenerationInput }>(
    root,
    {
      schema: {
        body: Type.Object(
          {
            session_id: Type.String({ minLength: 1 }),
            kind: Type.Enum(MediaKind),
            provider: Type.Optional(Type.Enum(LLMProviders)),
            model: Type.Optional(Type.String({ minLength: 1 })),
            prompt: Type.String({ minLength: 1 }),
            filename: Type.Optional(Type.String()),
            reference_artifact_ids: Type.Optional(
              Type.Array(Type.String(), { maxItems: 16 })
            ),
            options: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          },
          { additionalProperties: false }
        )
      }
    },
    async (request) => generateMedia(request.body)
  )
  fastify.get<{ Params: { sessionId: string, jobId: string } }>(
    `${root}/:sessionId/:jobId`,
    async (request) =>
      getMediaGeneration(request.params.sessionId, request.params.jobId)
  )
}
