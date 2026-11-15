import fs from 'node:fs/promises'
import path from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

import { WORKSPACE_COLORS, WORKSPACE_LIMITS, WorkspaceResourceKind } from '@@/bridges/runtime/contracts/workspace'
import type { WorkspaceInput } from '@@/bridges/runtime/contracts/workspace'
import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { WEB_SESSION_RUNTIME } from '@/core/session-manager/web-session-runtime'
import { FileHelper } from '@/helpers/file-helper'

const resourceSchema = Type.Object({
  kind: Type.Union([Type.Literal(WorkspaceResourceKind.Folder), Type.Literal(WorkspaceResourceKind.Link)]),
  label: Type.String({ maxLength: WORKSPACE_LIMITS.resourceLabel }),
  location: Type.String({ minLength: 1, maxLength: WORKSPACE_LIMITS.resourceLocation }),
  device: Type.Optional(Type.String({ maxLength: 128 }))
}, { additionalProperties: false })
const inputSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: WORKSPACE_LIMITS.name }),
  brief: Type.String({ maxLength: WORKSPACE_LIMITS.brief }),
  resources: Type.Array(resourceSchema, { maxItems: WORKSPACE_LIMITS.resources }),
  color: Type.Optional(Type.Union(WORKSPACE_COLORS.map((color) => Type.Literal(color.id))))
}, { additionalProperties: false })
const paramsSchema = Type.Object({ workspace_id: Type.String({ format: 'uuid' }) })
const pageSchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ maxLength: 512 }))
})

function normalizeName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new Error('Name your workspace before saving it.')
  }

  return normalized
}

async function normalizeInput(input: WorkspaceInput): Promise<WorkspaceInput> {

  return { ...input, name: normalizeName(input.name), brief: input.brief.trim(),
    resources: await Promise.all(input.resources.map(async (resource) => {
      let location = resource.location.trim()
      if (resource.kind === WorkspaceResourceKind.Link) {
        const url = new URL(location)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          throw new Error('Resources need an HTTP or HTTPS link.')
        }
        location = url.href
      } else if (!resource.device) {
        location = FileHelper.expandHomeAlias(location)
        if (!path.isAbsolute(location)) {
          throw new Error('Use an absolute folder path or your home shortcut.')
        }
        // Missing or disconnected resources can recover without being reattached.
        // Filesystem probes stay asynchronous so slow volumes cannot block Core.
        try {
          if (!(await fs.stat(location)).isDirectory()) {
            throw new Error('A folder resource must point to a directory.')
          }
          location = await fs.realpath(location)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
          }
          location = path.normalize(location)
        }
      }

      return { ...resource, label: resource.label.trim(), location }
    })) }
}

/**
 * Exposes project context through the existing authenticated profile API.
 */
export const workspaceRoutes: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const base = `/api/${options.apiVersion}/workspaces`
  const changed = (): void => {
    CONVERSATION_SESSION_MANAGER.events.emit('updated')
  }

  const runningCounts = (): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const sessionId of WEB_SESSION_RUNTIME.getRunningSessionIds()) {
      const workspaceId = CONVERSATION_REPOSITORY.readSession(sessionId)?.workspaceId
      if (workspaceId) {
        counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1)
      }
    }

    return counts
  }

  fastify.get(base, async () => {
    const running = runningCounts()

    return { workspaces: CONVERSATION_REPOSITORY.workspaces.list().map((workspace) => ({
      ...workspace, runningSessionCount: running.get(workspace.id) ?? 0
    })) }
  })
  fastify.get<{ Querystring: Static<typeof pageSchema> }>(`${base}/recents`, {
    schema: { querystring: pageSchema }
  }, async (request, reply) => {
    try {
      CONVERSATION_SESSION_MANAGER.ensureReady()
      const page = CONVERSATION_REPOSITORY.listRecents(request.query)
      const running = runningCounts()

      return { items: page.items.map((item) => item.kind === 'session'
        ? { ...item, value: { ...item.value, status: WEB_SESSION_RUNTIME.isRunning(item.value.id) ? 'wip' : 'idle' } }
        : { ...item, value: { ...item.value, runningSessionCount: running.get(item.value.id) ?? 0 } }), next_cursor: page.nextCursor }
    } catch (error) {
      return reply.code(400).send({ message: String(error) })
    }
  })
  fastify.post<{ Body: Static<typeof inputSchema> }>(base, { schema: { body: inputSchema } }, async (request, reply) => {
    try {
      const workspace = CONVERSATION_REPOSITORY.workspaces.create(await normalizeInput(request.body))
      changed()

      return { workspace }
    } catch (error) {
      return reply.code(400).send({ message: String(error) })
    }
  })
  fastify.put<{ Params: Static<typeof paramsSchema>, Body: Static<typeof inputSchema> }>(`${base}/:workspace_id`, {
    schema: { params: paramsSchema, body: inputSchema }
  }, async (request, reply) => {
    if (!CONVERSATION_REPOSITORY.workspaces.get(request.params.workspace_id)) {
      return reply.code(404).send({ message: 'Workspace not found.' })
    }
    try {
      const workspace = CONVERSATION_REPOSITORY.workspaces.update(request.params.workspace_id, await normalizeInput(request.body))
      changed()

      return { workspace }
    } catch (error) {
      return reply.code(400).send({ message: String(error) })
    }
  })
  fastify.delete<{ Params: Static<typeof paramsSchema> }>(`${base}/:workspace_id`, {
    schema: { params: paramsSchema }
  }, async (request, reply) => {
    const id = request.params.workspace_id
    if (!CONVERSATION_REPOSITORY.workspaces.get(id)) {
      return reply.code(404).send({ message: 'Workspace not found.' })
    }
    if (CONVERSATION_SESSION_MANAGER.listSessions().some((session) =>
      session.workspaceId === id && (WEB_SESSION_RUNTIME.isRunning(session.id) || CONVERSATION_SESSION_MANAGER.isAgentTurnActive(session.id)))) {
      return reply.code(409).send({ message: 'Stop this workspace’s active turns before removing it.' })
    }
    const detached = CONVERSATION_REPOSITORY.workspaces.remove(id)
    for (const sessionId of detached) {
      CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(sessionId)
    }
    changed()

    return { success: true }
  })
}
