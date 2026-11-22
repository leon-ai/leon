import { useRef } from 'react'
import { clsx } from 'clsx'

import { Icon } from '@/components/icon'
import { useExitCleanup } from '@/hooks/use-exit-cleanup'
import { useTheme } from '@/hooks/use-theme'
import { OWNER_ATTACHMENT_MAX_COUNT } from '../../../../../server/src/core/owner-attachments/owner-attachment-contract'

import './attachment-drop-zone.sass'

export enum AttachmentDropPhase {
  Idle = 'idle',
  Hovering = 'hovering',
  Reading = 'reading',
  Dropped = 'dropped'
}

/**
 * Keeps drop feedback independent of file acceptance: previews appear immediately
 * while native transitions gather the papers and release the blurred overlay.
 */
export function AttachmentDropZone({ phase = AttachmentDropPhase.Hovering, count = 0, onExited }: {
  phase?: AttachmentDropPhase
  count?: number
  onExited?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dropped = phase === AttachmentDropPhase.Dropped
  const theme = useTheme()
  // Scope the opposite palette to the papers so the folder keeps its accent.
  const paperTheme = theme === 'dark' ? 'light' : 'dark'

  useExitCleanup(ref, dropped, () => onExited?.())

  return <div ref={ref} className={clsx('attachment-drop-zone', { 'attachment-drop-zone-dropped': dropped })} role="status">
    <div className="attachment-drop-content">
      <div className="attachment-drop-art" aria-hidden="true">
        <span className="attachment-drop-folder-back" />
        <span className="attachment-drop-paper attachment-drop-paper-image" data-theme={paperTheme}><Icon name="multi-image-line" /></span>
        <span className="attachment-drop-paper attachment-drop-paper-text" data-theme={paperTheme}><Icon name="file-text-line" /></span>
        <span className="attachment-drop-paper attachment-drop-paper-code" data-theme={paperTheme}><Icon name="code-s-slash-line" /></span>
        <span className="attachment-drop-folder-front"><Icon name="check-line" /></span>
      </div>
      <strong>{dropped ? `I’ve attached ${count} ${count === 1 ? 'file' : 'files'}`
        : phase === AttachmentDropPhase.Reading ? 'I’m reading the folder…' : 'Drop files to attach'}</strong>
      <span>Up to {OWNER_ATTACHMENT_MAX_COUNT} files per message</span>
    </div>
  </div>
}
