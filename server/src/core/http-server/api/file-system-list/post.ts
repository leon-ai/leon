import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { FileHelper } from '@/helpers/file-helper'

const FILE_SYSTEM_TRIGGER = '@'
const PATH_SEPARATOR = '/'
const MAXIMUM_FILE_SYSTEM_ENTRIES = 80
const MAXIMUM_EXPANDED_FOLDERS = 5
const MAXIMUM_FOLDER_CHILDREN = 24
const ROOT_PATH_VALUE = '@/'

const postFileSystemListSchema = {
  body: Type.Object({
    value: Type.String()
  })
} satisfies FastifySchema

interface PostFileSystemListSchema {
  body: Static<typeof postFileSystemListSchema.body>
}

interface FileSystemListEntry {
  name: string
  value: string
  absolutePath: string
  iconName: string
  type: 'file' | 'folder'
}

interface ScoredFileSystemListEntry extends FileSystemListEntry {
  entryPath: string
  score: number
}

function getRootPath(): string {
  return path.parse(os.homedir()).root
}

function normalizePathValue(value: string): string {
  return value.replaceAll(path.win32.sep, PATH_SEPARATOR)
}

function parsePathValue(value: string): {
  directoryPath: string
  directoryValue: string
  query: string
} {
  const normalizedValue = normalizePathValue(value.trim())
  const tokenValue = normalizedValue.startsWith(FILE_SYSTEM_TRIGGER)
    ? normalizedValue.slice(FILE_SYSTEM_TRIGGER.length)
    : normalizedValue
  const lastSeparatorIndex = tokenValue.lastIndexOf(PATH_SEPARATOR)
  const hasTrailingSeparator = tokenValue.endsWith(PATH_SEPARATOR)
  const directoryValue =
    hasTrailingSeparator || lastSeparatorIndex === -1
      ? hasTrailingSeparator
        ? tokenValue
        : ''
      : tokenValue.slice(0, lastSeparatorIndex + 1)
  const query =
    hasTrailingSeparator || lastSeparatorIndex === -1
      ? hasTrailingSeparator
        ? ''
        : tokenValue
      : tokenValue.slice(lastSeparatorIndex + 1)
  const rootPath = getRootPath()
  const directoryPath = directoryValue.startsWith(PATH_SEPARATOR)
    ? path.resolve(rootPath, directoryValue.slice(1))
    : path.resolve(os.homedir(), directoryValue)

  return {
    directoryPath,
    directoryValue,
    query
  }
}

function getFuzzyScore(query: string, value: string): number | null {
  const normalizedQuery = query.toLowerCase()
  const normalizedValue = value.toLowerCase()

  if (!normalizedQuery) {
    return 0
  }

  if (normalizedValue.startsWith(normalizedQuery)) {
    return 0
  }

  const includedAt = normalizedValue.indexOf(normalizedQuery)

  if (includedAt !== -1) {
    return includedAt + 10
  }

  let score = 20
  let valueIndex = 0

  for (const queryCharacter of normalizedQuery) {
    const foundAt = normalizedValue.indexOf(queryCharacter, valueIndex)

    if (foundAt === -1) {
      return null
    }

    score += foundAt - valueIndex
    valueIndex = foundAt + 1
  }

  return score
}

function buildEntryValue(directoryValue: string, entryName: string): string {
  if (directoryValue === PATH_SEPARATOR) {
    return `${ROOT_PATH_VALUE}${entryName}`
  }

  return `${FILE_SYSTEM_TRIGGER}${directoryValue}${entryName}`
}

function formatAbsolutePath(entryPath: string, type: FileSystemListEntry['type']): string {
  if (type === 'file' || entryPath.endsWith(path.sep)) {
    return entryPath
  }

  return `${entryPath}${path.sep}`
}

function sortEntries(
  leftEntry: ScoredFileSystemListEntry,
  rightEntry: ScoredFileSystemListEntry
): number {
  if (leftEntry.type !== rightEntry.type) {
    return leftEntry.type === 'folder' ? -1 : 1
  }

  if (leftEntry.score !== rightEntry.score) {
    return leftEntry.score - rightEntry.score
  }

  return leftEntry.name.localeCompare(rightEntry.name)
}

async function listFolderChildren(
  parentEntry: ScoredFileSystemListEntry
): Promise<ScoredFileSystemListEntry[]> {
  try {
    const childEntries = await fs.promises.readdir(parentEntry.entryPath, {
      withFileTypes: true
    })

    return childEntries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => {
        const type: FileSystemListEntry['type'] = entry.isDirectory()
          ? 'folder'
          : 'file'
        const entryPath = path.join(parentEntry.entryPath, entry.name)

        return {
          name: entry.name,
          value: `${parentEntry.value}${entry.name}${
            type === 'folder' ? PATH_SEPARATOR : ''
          }`,
          absolutePath: formatAbsolutePath(entryPath, type),
          iconName:
            type === 'folder'
              ? FileHelper.FOLDER_REMIX_ICON_NAME
              : FileHelper.getRemixIconName(entry.name),
          type,
          entryPath,
          score: 0
        }
      })
      .sort(sortEntries)
      .slice(0, MAXIMUM_FOLDER_CHILDREN)
  } catch {
    return []
  }
}

async function expandMatchedFolders(
  entries: ScoredFileSystemListEntry[],
  query: string
): Promise<ScoredFileSystemListEntry[]> {
  if (!query) {
    return entries
  }

  const foldersToExpand = entries
    .filter((entry) => entry.type === 'folder')
    .slice(0, MAXIMUM_EXPANDED_FOLDERS)
  const expandedEntries: ScoredFileSystemListEntry[] = []

  for (const entry of entries) {
    expandedEntries.push(entry)

    if (!foldersToExpand.includes(entry)) {
      continue
    }

    expandedEntries.push(...(await listFolderChildren(entry)))
  }

  return expandedEntries
}

export const postFileSystemList: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Body: PostFileSystemListSchema['body']
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/file-system/list`,
    schema: postFileSystemListSchema,
    handler: async (request, reply) => {
      const { directoryPath, directoryValue, query } = parsePathValue(
        request.body.value
      )

      try {
        const directoryEntries = await fs.promises.readdir(directoryPath, {
          withFileTypes: true
        })
        const matchedEntries = directoryEntries
          .filter((entry) => entry.isDirectory() || entry.isFile())
          .map((entry) => {
            const type: FileSystemListEntry['type'] = entry.isDirectory()
              ? 'folder'
              : 'file'
            const score = getFuzzyScore(query, entry.name)

            if (score === null) {
              return null
            }

            const entryPath = path.join(directoryPath, entry.name)

            return {
              name: entry.name,
              value: `${buildEntryValue(directoryValue, entry.name)}${
                type === 'folder' ? PATH_SEPARATOR : ''
              }`,
              absolutePath: formatAbsolutePath(entryPath, type),
              iconName:
                type === 'folder'
                  ? FileHelper.FOLDER_REMIX_ICON_NAME
                  : FileHelper.getRemixIconName(entry.name),
              type,
              entryPath,
              score
            }
          })
          .filter((entry): entry is ScoredFileSystemListEntry => {
            return entry !== null
          })
          .sort(sortEntries)

        const entries = (await expandMatchedFolders(matchedEntries, query))
          .slice(0, MAXIMUM_FILE_SYSTEM_ENTRIES)
          .map(({ name, value, absolutePath, iconName, type }) => {
            return {
              name,
              value,
              absolutePath,
              iconName,
              type
            }
          })

        reply.send({
          success: true,
          entries
        })
      } catch (error) {
        reply.send({
          success: true,
          entries: [],
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })
}

export default postFileSystemList
