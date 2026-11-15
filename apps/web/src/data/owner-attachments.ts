import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'
import { requestAPI } from './api'

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
/**
 * Retains command identity while retrying the same draft after uncertain delivery.
 */
export function createSendMessageInput(query: string, attachments: OwnerAttachmentDraft[], previous?: SendMessageInput, onUploadProgress?: AttachmentUploadListener): SendMessageInput {
  if (previous?.query === query &&
    JSON.stringify(previous.attachments?.map((file) => file.id) ?? []) === JSON.stringify(attachments.map((file) => file.id))) {
    return { ...previous, ...(onUploadProgress ? { onUploadProgress } : {}) }
  }

  return { id: crypto.randomUUID(), query, attachments, ...(onUploadProgress ? { onUploadProgress } : {}) }
}

/**
 * Sends binary files sequentially to bound memory and network work. Receipts are
 * scoped to the profile/session and reused after an uncertain message delivery.
 */
export async function uploadOwnerAttachments(profile: string, sessionId: string, drafts: OwnerAttachmentDraft[], onProgress?: AttachmentUploadListener): Promise<Artifact[]> {
  const scope = JSON.stringify([profile, sessionId])
  const attachments: Artifact[] = []
  for (const draft of drafts) {
    const receipts = uploadedFiles.get(draft.file) ?? new Map<string, Artifact>()
    let attachment = receipts.get(scope)
    if (!attachment) {
      const params = new URLSearchParams({ filename: draft.filename, media_type: draft.mediaType })
      onProgress?.(draft.id, { state: AttachmentUploadState.Uploading, loaded: 0, total: draft.file.size })
      try {
        const result = await requestAPI<{ attachment: Artifact }>(`sessions/${encodeURIComponent(sessionId)}/attachments?${params}`, {
          method: 'POST', body: draft.file, headers: { 'Content-Type': 'application/octet-stream' },
          onUploadProgress: (loaded) => onProgress?.(draft.id, {
            state: loaded >= draft.file.size ? AttachmentUploadState.Processing : AttachmentUploadState.Uploading,
            loaded: Math.min(loaded, draft.file.size), total: draft.file.size
          })
        })
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
