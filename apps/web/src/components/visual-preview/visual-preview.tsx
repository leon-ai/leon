import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import { Dialog } from '@/components/dialog'
import './visual-preview.sass'

interface VisualSelection {
  title: string
  content: ReactNode
  opener: HTMLButtonElement | null
  svg?: string | undefined
}

const VisualContext = createContext<((selection: VisualSelection) => void) | null>(null)

/**
 * Keeps enlarged visuals alive independently of virtualized feed rows.
 */
export function VisualPreviewProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<VisualSelection | null>(null)
  const [open, setOpen] = useState(false)
  const blobUrl = useRef<string | undefined>(undefined)
  const release = useCallback((): void => {
    if (blobUrl.current) {
      URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = undefined
    }
  }, [])
  useEffect(() => release, [release])
  const show = useCallback((next: VisualSelection): void => {
    release()
    if (next.svg) {
      // An image document isolates diagram IDs from the still-mounted preview.
      blobUrl.current = URL.createObjectURL(new Blob([next.svg], { type: 'image/svg+xml' }))
    }
    setSelection({ ...next, content: blobUrl.current
      ? <img className="visual-diagram-image" src={blobUrl.current} alt={next.title} /> : next.content })
    setOpen(true)
  }, [release])
  const close = useCallback(() => setOpen(false), [])

  return (
    <VisualContext value={show}>
      {children}
      {selection && <Dialog open={open} title={selection.title} centered size="wide" hideFooter
        className="visual-dialog" onClose={close} onAfterClose={() => {
          selection.opener?.focus({ preventScroll: true })
          release()
          setSelection(null)
        }}>
        <div className="visual-dialog-content" tabIndex={0}>{selection.content}</div>
      </Dialog>}
    </VisualContext>
  )
}

/**
 * Offers the same keyboard-accessible enlargement for trusted images and diagrams.
 */
export function VisualPreview({ title, label, svg, fullWidth = false, children }: {
  title: string
  label?: string
  svg?: string
  fullWidth?: boolean
  children: ReactNode
}) {
  const show = useContext(VisualContext)
  const ref = useRef<HTMLButtonElement>(null)

  return <button ref={ref} type="button" className={clsx('visual-preview', { 'visual-preview-full-width': fullWidth })} aria-label={label ?? `Enlarge ${title}`}
    onClick={() => show?.({ title, content: children, svg, opener: ref.current })}>{children}</button>
}
