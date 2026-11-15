import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'
import { requestAPI } from './api'
import { queryClient } from '@/query-client'
import { PROFILE_AUTH_QUERY_KEY } from './profile-query'

export interface OwnerAttachmentDraft {
  id: string
  file: File
  filename: string
  mediaType: string
  url: string
}

export interface SendMessageInput {
  id: string
  query: string
  attachments?: OwnerAttachmentDraft[]
  onUploadProgress?: AttachmentUploadListener
  signal?: AbortSignal
}

export enum AttachmentUploadState {
  Queued = 'queued',
  Uploading = 'uploading',
  Processing = 'processing',
  Complete = 'complete',
  Failed = 'failed'
}

export interface AttachmentUploadProgress {
  state: AttachmentUploadState
  loaded: number
  total: number
}

export type AttachmentUploadListener = (id: string, progress: AttachmentUploadProgress) => void

// File identity survives retries; weak keys release upload receipts with drafts.
const uploadedFiles = new WeakMap<File, Map<string, Artifact>>()
const submissionCleanup = new WeakMap<SendMessageInput, () => void>()

/**
 * Releases large mutation variables after acceptance or cancellation, while
 * failed drafts retain their files for an explicit retry.
 */
export function releaseSendMessageFiles(input: SendMessageInput): void {
  submissionCleanup.get(input)?.()
  submissionCleanup.delete(input)
  delete input.attachments
  delete input.onUploadProgress
}

/**
 * Stops queued requests before they can use another profile's browser cookie.
 */
export function assertSendMessageActive(profile: string, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  const active = queryClient.getQueryData<{ authenticated: boolean, profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)
  if (!profile || !active?.authenticated || active.profile_name !== profile) {
    throw new DOMException('This message belongs to another profile.', 'AbortError')
  }
}

/**
 * Retains command identity while retrying the same draft after uncertain delivery.
 */
export function createSendMessageInput(query: string, attachments: OwnerAttachmentDraft[], previous?: SendMessageInput, onUploadProgress?: AttachmentUploadListener, signal?: AbortSignal): SendMessageInput {
  const sameDraft = previous?.query === query &&
    JSON.stringify(previous.attachments?.map((file) => file.id) ?? []) === JSON.stringify(attachments.map((file) => file.id))
  const input: SendMessageInput = {
    id: sameDraft ? previous!.id : crypto.randomUUID(), query, attachments,
    ...(onUploadProgress ? { onUploadProgress } : {}), ...(signal ? { signal } : {})
  }
  if (previous) {
    releaseSendMessageFiles(previous)
  }
  if (signal) {
    const release = (): void => releaseSendMessageFiles(input)
    signal.addEventListener('abort', release, { once: true })
    submissionCleanup.set(input, () => signal.removeEventListener('abort', release))
    if (signal.aborted) {
      release()
    }
  }

  return input
}

/**
 * Sends binary files sequentially to bound memory and network work. Receipts are
 * scoped to the profile/session and reused after an uncertain message delivery.
 */
export async function uploadOwnerAttachments(profile: string, sessionId: string, drafts: OwnerAttachmentDraft[], onProgress?: AttachmentUploadListener, signal?: AbortSignal): Promise<Artifact[]> {
  const scope = JSON.stringify([profile, sessionId])
  const attachments: Artifact[] = []
  for (const draft of drafts) {
    assertSendMessageActive(profile, signal)
    const receipts = uploadedFiles.get(draft.file) ?? new Map<string, Artifact>()
    let attachment = receipts.get(scope)
    if (!attachment) {
      const params = new URLSearchParams({ filename: draft.filename, media_type: draft.mediaType, upload_id: draft.id })
      onProgress?.(draft.id, { state: AttachmentUploadState.Uploading, loaded: 0, total: draft.file.size })
      try {
        const result = await requestAPI<{ attachment: Artifact }>(`sessions/${encodeURIComponent(sessionId)}/attachments?${params}`, {
          method: 'POST', body: draft.file, headers: { 'Content-Type': 'application/octet-stream' },
          ...(signal ? { signal } : {}),
          onUploadProgress: (loaded) => onProgress?.(draft.id, {
            state: loaded >= draft.file.size ? AttachmentUploadState.Processing : AttachmentUploadState.Uploading,
            loaded: Math.min(loaded, draft.file.size), total: draft.file.size
          })
        })
        assertSendMessageActive(profile, signal)
        attachment = result.attachment
      } catch (error) {
        onProgress?.(draft.id, { state: AttachmentUploadState.Failed, loaded: 0, total: draft.file.size })
        throw error
      }
      receipts.set(scope, attachment)
      uploadedFiles.set(draft.file, receipts)
    }
    onProgress?.(draft.id, { state: AttachmentUploadState.Complete, loaded: draft.file.size, total: draft.file.size })
    attachments.push(attachment)
  }

  return attachments
}
