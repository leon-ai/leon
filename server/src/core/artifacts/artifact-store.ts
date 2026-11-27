import { MAX_GENERATED_ARTIFACT_BYTES, API_VERSION } from '@/constants'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { isPortableArtifactFilename, type Artifact } from './artifact-types'

function component(value: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    path.basename(value) !== value ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error('Invalid artifact identifier.')
  }

  return value
}

function directory(sessionId: string, id: string): string {
  return path.join(
    getSatelliteArtifactRoot(getActiveProfileName(), component(sessionId)),
    'deliverables',
    component(id)
  )
}

async function contentDigest(filename: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) {
    digest.update(chunk)
  }

  return digest.digest('hex')
}

/**
 * Signals reuse of an immutable artifact ID for different metadata or bytes.
 */
export class ArtifactConflictError extends Error {}

/**
 * Publishes completed outputs atomically. A caller-provided ID can be retried,
 * including concurrently, only when its metadata and content remain identical.
 */
export async function registerArtifact(input: {
  id?: string
  session_id: string
  path: string
  filename: string
  mime_type: string
  source: string
}): Promise<Artifact> {
  const filename = component(input.filename)

  if (!isPortableArtifactFilename(filename)) {
    throw new Error('Invalid artifact filename.')
  }

  if (
    !input.mime_type ||
    input.mime_type.includes('\r') ||
    input.mime_type.includes('\n')
  ) {
    throw new Error('Invalid artifact media type.')
  }

  const id = component(input.id ?? randomUUID())
  const target = directory(input.session_id, id)
  const source = await fs.open(input.path, 'r')
  let temporary: string | undefined

  try {
    const stat = await source.stat()

    if (!stat.isFile() || stat.size > MAX_GENERATED_ARTIFACT_BYTES) {
      throw new Error('Artifact must be a regular file within the size limit.')
    }

    await fs.mkdir(path.dirname(target), {
      recursive: true,
      mode: 0o700
    })
    temporary = await fs.mkdtemp(path.join(path.dirname(target), '.register-'))
    await fs.mkdir(path.join(temporary, 'content'), { mode: 0o700 })
    // Read from the opened handle, so replacing the source path cannot change the file.
    const destination = path.join(temporary, 'content', filename)

    if (stat.size) {
      await pipeline(
        source.createReadStream({
          autoClose: false,
          start: 0,
          end: stat.size - 1
        }),
        createWriteStream(destination, { flags: 'wx', mode: 0o600 })
      )
    } else {
      await fs.writeFile(destination, '', { flag: 'wx', mode: 0o600 })
    }

    const after = await source.stat()

    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      (await fs.stat(destination)).size !== stat.size
    ) {
      throw new Error('Artifact changed while being registered.')
    }

    const artifact: Artifact = {
      id,
      session_id: input.session_id,
      filename,
      mime_type: input.mime_type,
      size_bytes: stat.size,
      created_at: Date.now(),
      source: input.source,
      url: `/api/${API_VERSION}/artifacts/${encodeURIComponent(input.session_id)}/${id}`
    }

    await fs.writeFile(
      path.join(temporary, 'metadata.json'),
      JSON.stringify(artifact),
      { flag: 'wx', mode: 0o600 }
    )

    try {
      await fs.rename(temporary, target)
      return artifact
    } catch (error) {
      if (!input.id) {
        throw error
      }
      // A complete directory is the publication boundary. A concurrent winner
      // is never removed or overwritten by this attempt's failure or cleanup.
      const existing = await readArtifact(input.session_id, id).catch(() => undefined)
      if (!existing) {
        throw error
      }
      const saved = existing.artifact
      if (saved.filename !== filename || saved.mime_type !== input.mime_type ||
        saved.source !== input.source || saved.size_bytes !== stat.size) {
        throw new ArtifactConflictError('This upload ID already belongs to another file.')
      }
      const [previousDigest, nextDigest] = await Promise.all([
        contentDigest(existing.path), contentDigest(destination)
      ])
      if (previousDigest !== nextDigest) {
        throw new ArtifactConflictError('This upload ID already belongs to different file contents.')
      }

      return saved
    }
  } finally {
    await source.close()
    if (temporary) {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
}

/**
 * Resolves only registered artifacts in the authenticated profile's session.
 */
export async function readArtifact(
  sessionId: string,
  id: string
): Promise<{ artifact: Artifact, path: string }> {
  const root = directory(sessionId, id)
  const artifact = JSON.parse(
    await fs.readFile(path.join(root, 'metadata.json'), 'utf8')
  ) as Artifact

  if (artifact.id !== id || artifact.session_id !== sessionId) {
    throw new Error('Artifact metadata does not match its owner.')
  }

  return {
    artifact,
    path: path.join(root, 'content', component(artifact.filename))
  }
}

/**
 * Saves an editable copy of a registered attachment without replacing a file
 * that already occupies the destination.
 */
export async function saveArtifactFile(
  sessionId: string,
  id: string,
  destination?: string
): Promise<{ path: string, bytesWritten: number }> {
  if (destination !== undefined && !path.isAbsolute(destination)) {
    throw new Error('Provide an absolute destination on the Leon server.')
  }

  const source = await readArtifact(sessionId, id)
  const target = destination ?? path.join(getProfilePaths().files, source.artifact.filename)
  const directory = path.dirname(target)

  if (destination === undefined) {
    await fs.mkdir(directory, { recursive: true })
  }

  // Stage beside the destination so publication is exclusive on the same filesystem.
  const staging = await fs.mkdtemp(path.join(directory, '.leon-save-'))
  const temporary = path.join(staging, 'content')

  try {
    await fs.copyFile(source.path, temporary)
    await fs.link(temporary, target)

    return { path: target, bytesWritten: source.artifact.size_bytes }
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
