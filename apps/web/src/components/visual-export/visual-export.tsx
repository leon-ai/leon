import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { useToast } from '@/components/toast'
import { Icon } from '@/components/icon'
import { useActionConfirmation } from '@/hooks/use-action-confirmation'
import './visual-export.sass'

interface VisualExportActionsProps {
  capture: () => Promise<Blob>
  disabled?: boolean
}

/**
 * Shares image actions while each renderer retains ownership of its content.
 */
export function VisualExportActions({ capture, disabled = false }: VisualExportActionsProps) {
  const { showToast } = useToast()
  const [pending, setPending] = useState(false)
  const { confirmed: downloaded, confirm: confirmDownload, reset: resetDownload } = useActionConfirmation()
  const operation = useRef(0)
  const downloadURL = useRef<string | undefined>(undefined)
  const capturing = useRef(false)
  const currentCapture = useRef(capture)
  currentCapture.current = capture

  useEffect(() => () => {
    operation.current += 1
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }
  }, [])

  async function image(): Promise<Blob> {
    if (capturing.current) {
      throw new Error('An image is already being prepared.')
    }
    capturing.current = true
    const currentOperation = operation.current
    setPending(true)
    try {
      const blob = await currentCapture.current()
      if (currentOperation !== operation.current) {
        throw new Error('This visual is no longer open.')
      }

      return blob
    } finally {
      if (currentOperation === operation.current) {
        capturing.current = false
        setPending(false)
      }
    }
  }

  async function copy(): Promise<void> {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Use Download image in this browser instead.')
    }
    // Register the write during the click; Safari also requires activation
    // before asynchronous image capture finishes.
    const data = image()
    // A permission denial can reject before the browser consumes the image
    // promise. Keep a later capture failure from becoming an unhandled rejection.
    void data.catch(() => undefined)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': data })])
  }

  async function download(): Promise<void> {
    const currentOperation = operation.current
    resetDownload()
    try {
      const blob = await image()
      if (downloadURL.current) {
        URL.revokeObjectURL(downloadURL.current)
      }
      downloadURL.current = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadURL.current
      link.download = 'leon-visual.png'
      link.click()
      confirmDownload()
    } catch {
      if (currentOperation === operation.current) {
        showToast({ type: 'error', title: 'I couldn’t download this image',
          description: 'Try again with a smaller visual or reload the conversation.' })
      }
    }
  }

  return <div className="visual-export-actions" data-image-export-ignore>
    <CopyButton onCopy={copy} iconName="multi-image" label="Copy image" tone="muted" disabled={disabled} busy={pending}
      errorTitle="I couldn’t copy this image" errorDescription="Try Download image instead. Very large visuals may need to be made smaller." />
    <Button icon={<Icon name="image-download" state={downloaded ? 'confirmed' : 'idle'} />}
      tooltipMessage={downloaded ? 'Download started' : 'Download image'} tone="muted" disabled={disabled || pending}
      onClick={() => void download()} />
  </div>
}

/**
 * Makes a single visual exportable without including its action toolbar.
 */
export function ExportableVisual({ children, disabled = false, contentSelector, canvasImages }: {
  children: ReactNode
  disabled?: boolean
  contentSelector?: string
  canvasImages?: (element: HTMLElement) => Promise<ReadonlyMap<HTMLCanvasElement, string>>
}) {
  const element = useRef<HTMLDivElement>(null)

  async function capture(): Promise<Blob> {
    const target = contentSelector ? element.current?.querySelector<HTMLElement>(contentSelector) : element.current
    if (!target) {
      throw new Error('This visual is no longer open.')
    }
    const [{ captureImage }, { VISUAL_FONT_CSS }] = await Promise.all([import('./capture-image'), import('./visual-fonts')])
    const images = await canvasImages?.(target)

    return captureImage(target, VISUAL_FONT_CSS, images ? () => images : undefined)
  }

  return <div className="exportable-visual">
    <VisualExportActions capture={capture} disabled={disabled} />
    <div className="visual-export-content" ref={element}>{children}</div>
  </div>
}
