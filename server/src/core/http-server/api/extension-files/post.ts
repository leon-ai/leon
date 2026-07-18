import fs from 'node:fs'
import path from 'node:path'

import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import jq from 'node-jq'
import type { Json as NodeJQJson } from 'node-jq/lib/options'

import type { APIOptions } from '@/core/http-server/http-server'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { JsonRedactionHelper } from '@/helpers/json-redaction-helper'

const SETTINGS_FILE_NAME = 'settings.json'
const MEMORY_FOLDER_NAME = 'memory'

const postExtensionFileReadSchema = {
  body: Type.Object({
    owner_type: Type.Union([Type.Literal('skill'), Type.Literal('tool')]),
    owner_id: Type.String(),
    file_type: Type.Union([Type.Literal('settings'), Type.Literal('memory')]),
    skill_type: Type.Optional(
      Type.Union([Type.Literal('native'), Type.Literal('agent')])
    ),
    file_name: Type.Optional(Type.String()),
    jq: Type.Optional(Type.String())
  })
} satisfies FastifySchema

interface PostExtensionFileReadSchema {
  body: Static<typeof postExtensionFileReadSchema.body>
}

function getSafePathSegments(value: string): string[] | null {
  const segments = value.split(path.posix.sep)

  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(path.win32.sep)
    )
  ) {
    return null
  }

  return segments
}

function isJsonFileName(value: string): boolean {
  return (
    path.basename(value) === value &&
    path.win32.basename(value) === value &&
    value.endsWith('.json')
  )
}

function resolveProfileJsonPath(
  body: PostExtensionFileReadSchema['body']
): string | null {
  const ownerSegments = getSafePathSegments(body.owner_id)

  if (!ownerSegments) {
    return null
  }

  if (body.owner_type === 'tool') {
    if (body.file_type !== 'settings') {
      return null
    }

    return path.join(
      getProfilePaths().tools,
      ...ownerSegments,
      SETTINGS_FILE_NAME
    )
  }

  const profilePaths = getProfilePaths()
  const skillBasePath =
    body.skill_type === 'agent'
      ? profilePaths.agentSkills
      : profilePaths.nativeSkills
  const skillPath = path.join(skillBasePath, ...ownerSegments)

  if (body.file_type === 'settings') {
    return path.join(skillPath, SETTINGS_FILE_NAME)
  }

  if (!body.file_name || !isJsonFileName(body.file_name)) {
    return null
  }

  return path.join(skillPath, MEMORY_FOLDER_NAME, body.file_name)
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown
}

export const postExtensionFileRead: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Body: PostExtensionFileReadSchema['body']
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/extension-files/read`,
    schema: postExtensionFileReadSchema,
    handler: async (request, reply) => {
      const filePath = resolveProfileJsonPath(request.body)

      if (!filePath) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid extension file target.'
        })
      }

      try {
        const redactedJson = JsonRedactionHelper.redactSensitiveValues(
          await readJsonFile(filePath)
        )
        const filter = request.body.jq?.trim()
        const data = filter
          ? await jq.run(filter, redactedJson as NodeJQJson, {
              input: 'json',
              output: 'json'
            })
          : redactedJson

        return reply.send({
          success: true,
          data
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({
            success: false,
            error: 'Extension file not found.'
          })
        }

        return reply.code(400).send({
          success: false,
          error: (error as Error).message
        })
      }
    }
  })
}

export default postExtensionFileRead
