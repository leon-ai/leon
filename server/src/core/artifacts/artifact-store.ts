import { MAX_GENERATED_ARTIFACT_BYTES, API_VERSION } from '@/constants'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import type { Artifact } from './artifact-types'

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

/**
 * Copies a completed output into immutable session storage before exposing it.
 */
export async function registerArtifact(input: {
  session_id: string
  path: string
  filename: string
  mime_type: string
  source: string
}): Promise<Artifact> {
  const filename = component(input.filename)

  if (
    !input.mime_type ||
    input.mime_type.includes('\r') ||
    input.mime_type.includes('\n')
  ) {
    throw new Error('Invalid artifact media type.')
  }

  const source = await fs.open(input.path, 'r')
  const id = randomUUID()
  const target = directory(input.session_id, id)

  try {
    const stat = await source.stat()

    if (!stat.isFile() || stat.size > MAX_GENERATED_ARTIFACT_BYTES) {
      throw new Error('Artifact must be a regular file within the size limit.')
    }

    await fs.mkdir(path.join(target, 'content'), {
      recursive: true,
      mode: 0o700
    })
    // Read from the opened handle, so replacing the source path cannot change the file.
    const destination = path.join(target, 'content', filename)

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
      path.join(target, 'metadata.json'),
      JSON.stringify(artifact),
      { flag: 'wx', mode: 0o600 }
    )

    return artifact
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true })
    throw error
  } finally {
    await source.close()
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
