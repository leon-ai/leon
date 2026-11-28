import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'

export const ARTIFACT_PREVIEW_BYTES = 16_384
export const ARTIFACT_TEXT_COPY_BYTES = 1_048_576
const TEXT_MIME_TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml',
  'application/javascript', 'application/typescript', 'application/x-yaml', 'application/yaml'
])

/**
 * Identifies an artifact that exceeds the size budget for an action.
 */
export class ArtifactSizeError extends Error {}

/**
 * Classifies explicit text formats without interpreting arbitrary binary files.
 */
export function isTextArtifact(item: Pick<ArtifactItem, 'mimeType'>): boolean {
  const mime = item.mimeType.split(';')[0]!.trim().toLowerCase()

  return mime.startsWith('text/') || TEXT_MIME_TYPES.has(mime)
}

/**
 * Reads only local artifact bytes, cancelling the stream at its byte budget.
 * Range requests avoid transferring entire files just to show their first lines.
 */
export async function readArtifactResource(item: ArtifactItem, limit: number, signal: AbortSignal, excerpt = false): Promise<{ blob: Blob, truncated: boolean }> {
  const url = new URL(item.url, location.href)
  if (url.origin !== location.origin || !['http:', 'https:', 'blob:'].includes(url.protocol)) {
    throw new Error('Only local artifact files can be read.')
  }

  const response = await fetch(url, {
    credentials: 'same-origin', signal, redirect: 'error',
    ...(excerpt ? { headers: { Range: `bytes=0-${limit}` } } : {})
  })
  if (excerpt && response.status === 416 && response.headers.get('Content-Range') === 'bytes */0') {
    await response.body?.cancel()
    return { blob: new Blob([], { type: item.mimeType }), truncated: false }
  }
  if (!response.ok || !response.body) {
    throw new Error('This file is not available. Try downloading it again.')
  }
  if (!excerpt && Number(response.headers.get('Content-Length')) > limit) {
    await response.body.cancel()
    throw new ArtifactSizeError('This file is too large. Use Download instead.')
  }
  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  let size = 0
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const remaining = limit - size
      if (value.byteLength > remaining) {
        if (!excerpt) {
          throw new ArtifactSizeError('This file is too large. Use Download instead.')
        }
        chunks.push(value.slice(0, remaining))
        truncated = true
        break
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  signal.throwIfAborted()

  return { blob: new Blob(chunks, { type: item.mimeType }), truncated }
}
