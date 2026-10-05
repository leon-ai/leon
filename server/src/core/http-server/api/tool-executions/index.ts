import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { APIOptions } from '@/core/http-server/http-server'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { FileHelper } from '@/helpers/file-helper'
import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { readArtifact } from '@/core/artifacts/artifact-store'
import { TOOL_EXECUTION_MANAGER } from '@/core/tool-manager/tool-execution-manager'
import { TOOL_EXECUTION_MAX_WAIT_MS, MAX_GENERATED_ARTIFACT_BYTES } from '@/constants'

const DEFAULT_MAX_CHARS = 8_000
const MAX_CHARS = 30_000

interface ExecutionInput {
  executionId: string
  sessionId: string
  waitMs?: number
  options?: { jq?: string, offsetChars?: number, maxChars?: number }
}

/**
 * Resolve only saved JSON belonging to the authenticated execution's session.
 */
async function resolveRetainedOutput(
  reference: unknown,
  profileName: string,
  sessionId: string
): Promise<string | null> {
  if (!reference || typeof reference !== 'object') {
    return null
  }

  const retained = reference as { path?: unknown, artifactId?: unknown }
  let filename: string

  if (typeof retained.artifactId === 'string') {
    filename = (await readArtifact(sessionId, retained.artifactId)).path
  } else if (typeof retained.path === 'string') {
    filename = await fs.realpath(retained.path)
    const root = await fs.realpath(getSatelliteArtifactRoot(profileName, sessionId))
    const relative = path.relative(root, filename)

    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Retained output escapes its conversation.')
    }
  } else {
    throw new Error('Invalid retained output reference.')
  }

  const stat = await fs.stat(filename)

  if (!stat.isFile() || stat.size > MAX_GENERATED_ARTIFACT_BYTES) {
    throw new Error('Invalid or oversized retained output.')
  }

  return filename
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
      const filename = await resolveRetainedOutput(
        coverage['retainedOutput'],
        profileName,
        sessionId
      )
      const offset = projection.offsetChars ?? 0
      const maxChars = projection.maxChars ?? DEFAULT_MAX_CHARS
      let page: Awaited<ReturnType<typeof FileHelper.readTextFilePage>>

      if (filename && !projection.jq) {
        page = await FileHelper.readTextFilePage(filename, offset, maxChars)
      } else {
        const content = projection.jq
          ? filename
            ? await RuntimeHelper.projectJSONFile(projection.jq, filename)
            : await RuntimeHelper.projectJSON(projection.jq, output)
          : JSON.stringify(output)
        const end = Math.min(content.length, offset + maxChars)

        page = {
          content: content.slice(offset, end),
          totalChars: content.length,
          offsetChars: offset,
          nextOffsetChars: end < content.length ? end : null,
          truncated: end < content.length
        }
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
