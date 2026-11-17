import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'
import { DESKTOP_FILES_PATH, DESKTOP_UPLOAD_EVENT_MAX_CHARACTERS,
  type DesktopAttachmentFile } from '../../../../bridges/runtime/contracts/desktop-client'

/**
 * Accepts only opaque grants served by this application's own desktop host.
 */
export function isDesktopAttachmentFile(value: unknown): value is DesktopAttachmentFile {
  if (!value || typeof value !== 'object') {
    return false
  }
  const file = value as Partial<DesktopAttachmentFile>
  if (file.kind !== 'desktop-file' || typeof file.id !== 'string' ||
    !file.id || file.id.length > 80 || typeof file.name !== 'string' ||
    !Number.isSafeInteger(file.size) || file.size! <= 0 || typeof file.url !== 'string') {
    return false
  }
  try {
    const url = new URL(file.url, location.origin)

    return url.origin === location.origin && !url.search && !url.hash &&
      url.pathname === `${DESKTOP_FILES_PATH}${encodeURIComponent(file.id)}`
  } catch {
    return false
  }
}

/**
 * Releases a native reference without fetching or retaining its file contents.
 */
export function releaseDesktopAttachment(file: DesktopAttachmentFile): void {
  void fetch(file.url, { method: 'DELETE', credentials: 'include', keepalive: true })
    .catch(() => undefined)
}

/**
 * The native host streams the selected file directly to Core. Only bounded
 * progress records and the final artifact receipt pass through the renderer.
 */
export async function uploadDesktopAttachment(
  file: DesktopAttachmentFile, profile: string, sessionId: string,
  onProgress?: (loaded: number) => void, signal?: AbortSignal
): Promise<Artifact> {
  const response = await fetch(`${file.url}/upload`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, sessionId, uploadId: file.id }),
    ...(signal ? { signal } : {})
  })
  if (!response.ok || !response.body) {
    const result = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(result?.message || 'I could not upload this file. Please try pasting it again.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (line.length > DESKTOP_UPLOAD_EVENT_MAX_CHARACTERS) {
          throw new Error('The desktop host returned an invalid upload response.')
        }
        if (line) {
          const event = JSON.parse(line) as { type: string, loaded?: number, message?: string, attachment?: Artifact }
          if (event.type === 'error') {
            throw new Error(event.message || 'I could not upload this file.')
          }
          if (event.type === 'complete' && event.attachment?.session_id === sessionId) {
            return event.attachment
          }
          if (event.type === 'progress' && Number.isSafeInteger(event.loaded) &&
            event.loaded! >= 0 && event.loaded! <= file.size) {
            onProgress?.(event.loaded!)
          }
        }
        newline = pending.indexOf('\n')
      }
      if (pending.length > DESKTOP_UPLOAD_EVENT_MAX_CHARACTERS || done) {
        throw new Error('I did not receive confirmation for this upload. Please retry it.')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
