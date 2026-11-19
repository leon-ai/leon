import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { useToast } from '@/components/toast'
import { createUUID } from '@/utils/create-uuid'
import { AttachmentUploadState, type AttachmentUploadListener, type AttachmentUploadProgress, type OwnerAttachmentDraft } from '@/data/owner-attachments'
import {
  OWNER_ATTACHMENT_MAX_COUNT, getOwnerAttachmentFormat, getOwnerAttachmentSizeLimit
} from '../../../../../server/src/core/owner-attachment-contract'
import { AttachmentDropZone, AttachmentDropPhase } from './attachment-drop-zone'
import { DESKTOP_FILES_EVENT, type DesktopAttachmentFile, type DesktopFilesEvent } from '../../../../../bridges/runtime/contracts/desktop-client'
import { isDesktopAttachmentFile, releaseDesktopAttachment } from '@/data/desktop-attachments'
import { MAXIMUM_ATTACHMENT_ENTRIES, getDroppedAttachmentEntries, readDroppedAttachmentFiles } from './dropped-attachment-files'

const MAXIMUM_DISPLAYED_ISSUES = 5

export type ComposerAttachment = OwnerAttachmentDraft

function releaseAttachment(item: ComposerAttachment): void {
  if (isDesktopAttachmentFile(item.file)) {
    releaseDesktopAttachment(item.file)
  } else {
    URL.revokeObjectURL(item.url)
  }
}

/**
 * Keeps local files and object URLs within one composer's lifetime. Native file
 * drags are scoped to the main body so the sidebar never becomes a drop target.
 */
export function useComposerAttachments(container: RefObject<HTMLDivElement | null>, disabled: boolean) {
  const [items, setItems] = useState<ComposerAttachment[]>([])
  const itemsRef = useRef(items)
  const [dropPhase, setDropPhase] = useState(AttachmentDropPhase.Idle)
  const [droppedCount, setDroppedCount] = useState(0)
  const [reading, setReading] = useState(false)
  const [uploads, setUploads] = useState<Record<string, AttachmentUploadProgress>>({})
  const { showToast } = useToast()

  const clear = useCallback((): void => {
    for (const item of itemsRef.current) {
      releaseAttachment(item)
    }
    itemsRef.current = []
    setItems([])
    setUploads({})
    setDropPhase(AttachmentDropPhase.Idle)
  }, [])

  useEffect(() => () => {
    for (const item of itemsRef.current) {
      releaseAttachment(item)
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

  const add = useCallback((files: Iterable<File | DesktopAttachmentFile>, issues?: Set<string>): number => {
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
      const native = !(file instanceof File)
      const format = getOwnerAttachmentFormat(file.name, native ? '' : file.type)
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
      const url = native ? file.url : URL.createObjectURL(file.slice(0, file.size, format.mediaType))
      next.push({ id: createUUID(), file, filename: file.name, mediaType: format.mediaType, url })
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

  useEffect(() => {
    if (disabled) {
      return undefined
    }
    // The composer's lifetime scopes these handlers to session/new-session
    // pages. File paste works with focus anywhere on that page; text stays native.
    const paste = (event: ClipboardEvent): void => {
      if (!document.hidden && !event.defaultPrevented && event.clipboardData?.files.length) {
        event.preventDefault()
        add(event.clipboardData.files)
      }
    }
    const nativePaste = (event: Event): void => {
      const detail = (event as CustomEvent<DesktopFilesEvent>).detail
      if (!detail || !Array.isArray(detail.files)) {
        return
      }
      const files = detail.files.filter(isDesktopAttachmentFile)
      const issues = new Set(detail.issues ?? [])
      if (document.hidden) {
        files.forEach(releaseDesktopAttachment)
        return
      }
      add(files, issues)
      const accepted = new Set(itemsRef.current.map((item) => item.file))
      for (const file of files) {
        if (!accepted.has(file)) {
          releaseDesktopAttachment(file)
        }
      }
      reportIssues(issues)
    }
    document.addEventListener('paste', paste)
    window.addEventListener(DESKTOP_FILES_EVENT, nativePaste)

    return () => {
      document.removeEventListener('paste', paste)
      window.removeEventListener(DESKTOP_FILES_EVENT, nativePaste)
    }
  }, [add, disabled, reportIssues])

  useEffect(() => {
    const target = container.current?.closest<HTMLElement>('.app-main')
    setReading(false)
    if (!target || disabled) {
      setDropPhase(AttachmentDropPhase.Idle)
      return undefined
    }
    let depth = 0
    let feedbackVersion = 0
    const readers = new Set<AbortController>()
    const isFileDrag = (event: DragEvent): boolean => Boolean(event.dataTransfer?.types.includes('Files'))
    const cancelHover = (): void => {
      depth = 0
      // Native dragend follows a successful drop too. Let its acceptance
      // feedback finish while cancellation immediately removes hover feedback.
      setDropPhase((current) => current === AttachmentDropPhase.Dropped || current === AttachmentDropPhase.Reading
        ? current : AttachmentDropPhase.Idle)
    }
    const enter = (event: DragEvent): void => {
      if (isFileDrag(event)) {
        event.preventDefault()
        depth += 1
        feedbackVersion += 1
        setDropPhase(AttachmentDropPhase.Hovering)
      }
    }
    const over = (event: DragEvent): void => {
      if (isFileDrag(event)) {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'copy'
      }
    }
    const leave = (event: DragEvent): void => {
      if (isFileDrag(event)) {
        depth = Math.max(0, depth - 1)
        if (!depth) {
          cancelHover()
        }
      }
    }
    const drop = (event: DragEvent): void => {
      if (isFileDrag(event)) {
        event.preventDefault()
        depth = 0
        const version = ++feedbackVersion
        const entries = getDroppedAttachmentEntries(event.dataTransfer!)
        if (entries.some((entry) => entry.isDirectory)) {
          const controller = new AbortController()
          readers.add(controller)
          setReading(true)
          setDropPhase(AttachmentDropPhase.Reading)
          void (async () => {
            const issues = new Set<string>()
            let count = 0
            try {
              for await (const file of readDroppedAttachmentFiles(entries, controller.signal, (issue) => issues.add(issue))) {
                if (itemsRef.current.length >= OWNER_ATTACHMENT_MAX_COUNT) {
                  issues.add(`I can attach up to ${OWNER_ATTACHMENT_MAX_COUNT} files per message.`)
                  break
                }
                count += add([file], issues)
              }
              if (!controller.signal.aborted) {
                reportIssues(issues)
                if (feedbackVersion === version) {
                  setDroppedCount(count)
                  setDropPhase(count ? AttachmentDropPhase.Dropped : AttachmentDropPhase.Idle)
                }
              }
            } finally {
              readers.delete(controller)
              if (!controller.signal.aborted) {
                setReading(readers.size > 0)
              }
            }
          })()
          return
        }
        const count = add(event.dataTransfer!.files)
        setDroppedCount(count)
        setDropPhase(count ? AttachmentDropPhase.Dropped : AttachmentDropPhase.Idle)
      } else {
        cancelHover()
      }
    }
    const outsideDrop = (event: DragEvent): void => {
      if (!(event.target instanceof Node) || !target.contains(event.target)) {
        cancelHover()
      }
    }
    target.addEventListener('dragenter', enter)
    target.addEventListener('dragover', over)
    target.addEventListener('dragleave', leave)
    target.addEventListener('drop', drop)
    window.addEventListener('drop', outsideDrop)
    window.addEventListener('dragend', cancelHover)
    window.addEventListener('blur', cancelHover)

    return () => {
      for (const reader of readers) {
        reader.abort()
      }
      target.removeEventListener('dragenter', enter)
      target.removeEventListener('dragover', over)
      target.removeEventListener('dragleave', leave)
      target.removeEventListener('drop', drop)
      window.removeEventListener('drop', outsideDrop)
      window.removeEventListener('dragend', cancelHover)
      window.removeEventListener('blur', cancelHover)
    }
  }, [add, container, disabled, reportIssues])

  function remove(id: string): void {
    const item = itemsRef.current.find((entry) => entry.id === id)
    if (item) {
      releaseAttachment(item)
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
    items, uploads, reading, updateUpload, queueUploads, add, clear, remove,
    dropZone: dropPhase !== AttachmentDropPhase.Idle ? createPortal(
      <AttachmentDropZone phase={dropPhase} count={droppedCount} onExited={() => {
        setDropPhase((current) => current === AttachmentDropPhase.Dropped ? AttachmentDropPhase.Idle : current)
      }} />,
      container.current!.closest('.app-main')!
    ) : null
  }
}
