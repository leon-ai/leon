import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import { getInsightsUsage } from '@/core/insights/usage'
import { INSIGHTS_INTERVALS, INSIGHTS_RANGES, EVALUATION_SOURCES,
  type InsightsInterval, type EvaluationQuery } from '@/core/insights/insights-contract'
import { getTelemetrySetting, setTelemetrySetting } from '@/core/telemetry/profile-telemetry'
import { authenticateProfileCredential, readProfileCredentialFromHeaders } from '@/core/profile-auth'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { readEvaluationHistory } from '@/core/insights/evaluation-index'
import { projectEvaluationHistory } from '@/core/insights/evaluation-view'
import type { APIOptions } from '@/core/http-server/http-server'

const LOCAL_ADDRESSES = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])

interface InsightsQuery {
  days?: number
  provider?: string
  model?: string
  repeated?: boolean
  interval?: InsightsInterval
  contextPage?: number
}

function canChangeTelemetrySettings(request: FastifyRequest): boolean {
  if (LOCAL_ADDRESSES.has(request.raw.socket.remoteAddress ?? '') &&
    !request.headers['x-forwarded-for'] && !request.headers['forwarded']) {
    return true
  }

  const credential = readProfileCredentialFromHeaders({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    'x-leon-profile-token': String(request.headers['x-leon-profile-token'] ?? '')
  })
  return Boolean(authenticateProfileCredential(credential))
}

export const insightsPlugin: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const root = `/api/${options.apiVersion}/insights`
  fastify.addHook('preHandler', async (request, reply) => {
    const expectedProfile = request.headers['x-leon-insights-profile']
    if (expectedProfile !== undefined && expectedProfile !== getActiveProfileName()) {
      return reply.code(409).send({ message: 'The active profile has changed.' })
    }
  })

  fastify.get<{ Querystring: InsightsQuery }>(root, {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          days: { type: 'integer', enum: INSIGHTS_RANGES },
          provider: { type: 'string', maxLength: 256 },
          model: { type: 'string', maxLength: 512 },
          repeated: { type: 'boolean' },
          interval: { type: 'string', enum: INSIGHTS_INTERVALS },
          contextPage: { type: 'integer', minimum: 0, maximum: 100_000 }
        }
      }
    }
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    return getInsightsUsage(request.query)
  })

  fastify.get(`${root}/telemetry`, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return getTelemetrySetting()
  })

  fastify.put<{ Body: { enabled: boolean } }>(`${root}/telemetry`, {
    schema: {
      body: {
        type: 'object', required: ['enabled'], additionalProperties: false,
        properties: { enabled: { type: 'boolean' } }
      }
    }
  }, async (request, reply) => {
    if (!canChangeTelemetrySettings(request)) {
      return reply.code(401).send({ message: 'Sign in to change usage sharing from a remote client.' })
    }
    reply.header('cache-control', 'no-store')
    return setTelemetrySetting(request.body.enabled)
  })

  fastify.get<{ Querystring: EvaluationQuery }>(`${root}/evaluations`, {
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string', enum: EVALUATION_SOURCES },
          model: { type: 'string', maxLength: 256 },
          reasoning: { type: 'string', maxLength: 80 },
          suite: { type: 'string', maxLength: 64 },
          scenario: { type: 'string', maxLength: 256 },
          days: { type: 'integer', enum: INSIGHTS_RANGES },
          page: { type: 'integer', minimum: 0, maximum: 100_000 }
        }
      }
    }
  }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    try {
      return projectEvaluationHistory(await readEvaluationHistory(true), request.query)
    } catch {
      return projectEvaluationHistory(await readEvaluationHistory(false), request.query, true)
    }
  })
}
