import fs from 'node:fs/promises'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { SatelliteArtifactBundle } from '@/core/satellite/types'
import type { ToolExecutionResult } from '@/core/tool-executor'

const MAX_ARTIFACT_BYTES = 8 * 1_024 * 1_024
const MAX_ARTIFACT_ENTRIES = 64

/**
 * Derive the destination from the authenticated invocation, never the sender.
 */
export function getSatelliteArtifactRoot(profileName: string, sessionId: string): string {
  if (!sessionId || sessionId === '.' || sessionId === '..') {
    throw new Error('Satellite artifacts require a conversation session.')
  }
  return path.join(getProfilePaths(profileName).sessions, encodeURIComponent(sessionId), 'artifacts')
}

function relativeArtifactPath(root: string, candidate: string): string | null {
  // A Windows Satellite can connect to a Unix server, and vice versa.
  const paths = path.win32.isAbsolute(root) && !path.posix.isAbsolute(root) ? path.win32 : path.posix
  if (!paths.isAbsolute(candidate)) return null
  const relative = paths.relative(root, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) return null
  return relative.split(paths.sep).join('/')
}

function mapStrings(value: unknown, transform: (value: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, transform))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, transform)]))
  }
  return value
}

/**
 * Carry only current-session paths explicitly returned by a tool, not device files
 * mentioned in its inputs, logs or an entire recording directory.
 */
export async function collectSatelliteArtifacts(
  root: string,
  result: ToolExecutionResult
): Promise<SatelliteArtifactBundle | undefined> {
  const references = new Map<string, string>()
  mapStrings(result.data.output, (value) => {
    const relative = relativeArtifactPath(root, value)
    if (relative) references.set(relative, value)
    return value
  })
  if (!references.size) return undefined
  if (references.size > MAX_ARTIFACT_ENTRIES) throw new Error('Too many Satellite artifact references.')
  const canonicalRoot = await fs.realpath(root)
  const entries: SatelliteArtifactBundle['entries'] = []
  let bytes = 0
  for (const [relative, filename] of references) {
    const canonical = await fs.realpath(filename)
    if (!relativeArtifactPath(canonicalRoot, canonical)) {
      throw new Error('Satellite artifact escapes the current session.')
    }
    const stat = await fs.stat(canonical)
    if (stat.isDirectory()) {
      entries.push({ path: relative })
    } else if (stat.isFile()) {
      bytes += stat.size
      if (bytes > MAX_ARTIFACT_BYTES) throw new Error('Satellite artifacts exceed the transfer limit.')
      const content = await fs.readFile(canonical)
      if (content.length !== stat.size) throw new Error('Satellite artifact changed during transfer.')
      entries.push({ path: relative, dataBase64: content.toString('base64') })
    } else {
      throw new Error('Satellite artifacts must be regular files or directories.')
    }
  }
  return { root, entries }
}

async function ensureDirectory(root: string, relative: string): Promise<void> {
  let directory = root
  for (const segment of relative.split('/').filter(Boolean)) {
    directory = path.join(directory, segment)
    await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Satellite artifact destination must not contain symlinks.')
    }
  }
}

/**
 * Materialize bounded evidence before exposing server-local paths to skills.
 * Existing files are immutable: another result cannot overwrite prior evidence.
 */
export async function receiveSatelliteArtifacts(
  root: string,
  result: ToolExecutionResult,
  bundle: SatelliteArtifactBundle
): Promise<ToolExecutionResult> {
  if (!bundle || typeof bundle.root !== 'string' ||
      !(path.posix.isAbsolute(bundle.root) || path.win32.isAbsolute(bundle.root)) ||
      !Array.isArray(bundle.entries) || bundle.entries.length > MAX_ARTIFACT_ENTRIES) {
    throw new Error('Invalid Satellite artifact bundle.')
  }
  let bytes = 0
  const names = new Set<string>()
  // Validate the whole batch before creating any destination files.
  const entries = bundle.entries.map((entry) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path ||
        entry.path.includes('\\') || entry.path.includes(':') || entry.path.includes('\0') ||
        entry.path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
        names.has(entry.path)) throw new Error('Invalid Satellite artifact path.')
    names.add(entry.path)
    if (entry.dataBase64 === undefined) return { path: entry.path }
    if (typeof entry.dataBase64 !== 'string' || entry.dataBase64.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4) {
      throw new Error('Satellite artifacts exceed the transfer limit.')
    }
    const content = Buffer.from(entry.dataBase64, 'base64')
    bytes += content.length
    if (content.toString('base64') !== entry.dataBase64 || bytes > MAX_ARTIFACT_BYTES) {
      throw new Error('Invalid or oversized Satellite artifact data.')
    }
    return { path: entry.path, content }
  })
  await fs.mkdir(root, { recursive: true })
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Satellite artifact root must not be a symlink.')
  for (const entry of entries) {
    const directory = entry.content ? path.posix.dirname(entry.path) : entry.path
    await ensureDirectory(root, directory === '.' ? '' : directory)
    if (!entry.content) continue
    const filename = path.join(root, entry.path)
    await fs.writeFile(filename, entry.content, { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      const stat = await fs.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.content.length ||
          !(await fs.readFile(filename)).equals(entry.content)) {
        throw new Error('Satellite artifact conflicts with existing evidence.')
      }
    })
  }
  return {
    ...result,
    data: {
      ...result.data,
      output: mapStrings(result.data.output, (value) => {
        const relative = relativeArtifactPath(bundle.root, value)
        return relative && names.has(relative) ? path.join(root, relative) : value
      }) as Record<string, unknown>
    }
  }
}
