import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/toast'
import { AttachmentUploadState, type AttachmentUploadListener, type AttachmentUploadProgress, type OwnerAttachmentDraft } from '@/data/owner-attachments'
import {
  OWNER_ATTACHMENT_MAX_COUNT, getOwnerAttachmentFormat, getOwnerAttachmentSizeLimit
} from '../../../../../server/src/core/owner-attachment-contract'
const MAXIMUM_ATTACHMENT_ENTRIES = 2_000

const MAXIMUM_DISPLAYED_ISSUES = 5

export type ComposerAttachment = OwnerAttachmentDraft

/**
 * Keeps local files and object URLs within one composer's lifetime. Native file
 * drags are scoped to the main body so the sidebar never becomes a drop target.
 */
export function useComposerAttachments(disabled: boolean) {
  const [items, setItems] = useState<ComposerAttachment[]>([])
  const itemsRef = useRef(items)
  const [uploads, setUploads] = useState<Record<string, AttachmentUploadProgress>>({})
  const { showToast } = useToast()

  const clear = useCallback((): void => {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.url)
    }
    itemsRef.current = []
    setItems([])
    setUploads({})
  }, [])

  useEffect(() => () => {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.url)
    }
    // Submitted mutations can finish after navigation; they must not retain
    // or update the previous composer's file previews.
    itemsRef.current = []
  }, [])

  const reportIssues = useCallback((errors: Set<string>): void => {
    if (errors.size) {
      const descriptions = [...errors].slice(-MAXIMUM_DISPLAYED_ISSUES)
      if (errors.size > MAXIMUM_DISPLAYED_ISSUES) {
        descriptions.push(`I skipped ${errors.size - MAXIMUM_DISPLAYED_ISSUES} other files.`)
      }
      showToast({ type: 'warning', title: 'Some files could not be attached', description: descriptions.join('\n') })
    }
  }, [showToast])

  const add = useCallback((files: Iterable<File>, issues?: Set<string>): number => {
    if (disabled) {
      return 0
    }
    const next = [...itemsRef.current]
    const previousCount = next.length
    const errors = issues ?? new Set<string>()
    let examined = 0
    for (const file of files) {
      examined += 1
      if (examined > MAXIMUM_ATTACHMENT_ENTRIES) {
        errors.add('I stopped reading this selection. Please choose fewer files or a smaller folder.')
        break
      }
      if (next.some((item) => item.file === file)) {
        continue
      }
      if (next.length >= OWNER_ATTACHMENT_MAX_COUNT) {
        errors.add(`I can attach up to ${OWNER_ATTACHMENT_MAX_COUNT} files per message.`)
        break
      }
      const format = getOwnerAttachmentFormat(file.name, file.type)
      if (!format) {
        errors.add(`I can’t attach ${file.name}: this file type is not supported.`)
        continue
      }
      const limit = getOwnerAttachmentSizeLimit(format)
      if (!file.size || file.size > limit) {
        errors.add(`I can’t attach ${file.name}: choose a nonempty file up to ${limit / 1_024 / 1_024} MB.`)
        continue
      }
      // Browser MIME detection can be missing or use aliases. Give local media
      // previews the same canonical type that the upload validator will inspect.
      const preview = file.slice(0, file.size, format.mediaType)
      next.push({ id: crypto.randomUUID(), file, filename: file.name, mediaType: format.mediaType, url: URL.createObjectURL(preview) })
    }
    if (next.length !== previousCount) {
      itemsRef.current = next
      setItems(next)
    }
    if (!issues) {
      reportIssues(errors)
    }

    return next.length - previousCount
  }, [disabled, reportIssues])

  function remove(id: string): void {
    const item = itemsRef.current.find((entry) => entry.id === id)
    if (item) {
      URL.revokeObjectURL(item.url)
    }
    itemsRef.current = itemsRef.current.filter((entry) => entry.id !== id)
    setItems(itemsRef.current)
    setUploads((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  const updateUpload = useCallback<AttachmentUploadListener>((id, progress) => {
    if (itemsRef.current.some((item) => item.id === id)) {
      setUploads((previous) => ({ ...previous, [id]: progress }))
    }
  }, [])

  function queueUploads(): void {
    setUploads(Object.fromEntries(itemsRef.current.map((item) => [item.id, {
      state: AttachmentUploadState.Queued, loaded: 0, total: item.file.size
    }])))
  }

  return {
    items, uploads, updateUpload, queueUploads, add, clear, remove
  }
}
