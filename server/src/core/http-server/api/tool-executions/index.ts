import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { TOOL_EXECUTION_MANAGER } from '@/core/tool-manager/tool-execution-manager'
import { TOOL_EXECUTION_MAX_WAIT_MS } from '@/constants'

const DEFAULT_MAX_CHARS = 8_000
const MAX_CHARS = 30_000

interface ExecutionInput {
  executionId: string
  sessionId: string
  waitMs?: number
  options?: { jq?: string, offsetChars?: number, maxChars?: number }
}

/**
 * Authenticated transport for retained executions, scoped to the calling profile.
 */
export const toolExecutionsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.post<{ Params: { action: 'wait' | 'read' | 'cancel' }, Body: ExecutionInput }>(
    `/api/${options.apiVersion}/tool-executions/:action`,
    {
      schema: {
        params: Type.Object({ action: Type.Union([
          Type.Literal('wait'), Type.Literal('read'), Type.Literal('cancel')
        ]) }),
        body: Type.Object({
          executionId: Type.String({ minLength: 1 }),
          sessionId: Type.String({ minLength: 1 }),
          waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: TOOL_EXECUTION_MAX_WAIT_MS })),
          options: Type.Optional(Type.Object({
            jq: Type.Optional(Type.String({ minLength: 1 })),
            offsetChars: Type.Optional(Type.Integer({ minimum: 0 })),
            maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_CHARS }))
          }, { additionalProperties: false }))
        }, { additionalProperties: false })
      }
    },
    async (request) => {
      const { executionId, sessionId, waitMs } = request.body
      const profileName = getActiveProfileName()
      const { action } = request.params
      const snapshot = action === 'wait'
        ? await TOOL_EXECUTION_MANAGER.wait(profileName, sessionId, executionId, waitMs)
        : action === 'cancel'
          ? await TOOL_EXECUTION_MANAGER.cancel(profileName, sessionId, executionId)
          : TOOL_EXECUTION_MANAGER.read(profileName, sessionId, executionId)
      const { options: projection = {} } = request.body

      if (!snapshot.result) {
        return { execution: snapshot.execution }
      }

      // Query the original JSON before bounding its textual preview. A count or
      // filter therefore covers the retained result, rather than its first page.
      const output = snapshot.result.data.output
      const source = output['result']
      const coverage = source && typeof source === 'object' && !Array.isArray(source)
        ? source as Record<string, unknown>
        : output
      const offset = projection.offsetChars ?? 0
      const maxChars = projection.maxChars ?? DEFAULT_MAX_CHARS
      const content = projection.jq
        ? await RuntimeHelper.projectJSON(projection.jq, output)
        : JSON.stringify(output)
      const end = Math.min(content.length, offset + maxChars)
      const page = {
        content: content.slice(offset, end),
        totalChars: content.length,
        offsetChars: offset,
        nextOffsetChars: end < content.length ? end : null,
        truncated: end < content.length
      }

      return {
        execution: snapshot.execution,
        status: snapshot.result.status,
        message: snapshot.result.message,
        outputLogPath: snapshot.result.data.output_log_path,
        // Projections may reduce an incomplete scan to a scalar. Retain its
        // coverage separately so that a count cannot imply a complete search.
        sourceCoverage: {
          truncated: coverage['truncated'],
          reason: coverage['reason'],
          summary: coverage['summary']
        },
        ...page,
        ...(snapshot.result.data.model_files
          ? { modelFiles: snapshot.result.data.model_files }
          : {})
      }
    }
  )
}
