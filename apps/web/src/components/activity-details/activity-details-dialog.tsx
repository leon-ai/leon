import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/button'
import { useToast } from '@/components/toast'

import './activity-details.sass'

interface ActivityDetailsDialogProps extends Pick<ComponentProps<typeof Dialog>, 'open' | 'title' | 'onClose' | 'onAfterClose'> {
  path: string
  content: string | undefined
  contentName: string
  downloadFilename: string
  canCopy?: boolean
  notice?: ReactNode
  toolbar: ReactNode
  children: ReactNode
}

/**
 * Shares the inspector layout and text actions while each activity owns its content.
 */
export function ActivityDetailsDialog({
  open, title, path, content, contentName, downloadFilename,
  canCopy = true, notice, toolbar, children, onClose, onAfterClose
}: ActivityDetailsDialogProps) {
  const { showToast } = useToast()
  const downloadURL = useRef<string | undefined>(undefined)

  useEffect(() => (): void => {
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }
  }, [])

  async function copy(): Promise<void> {
    if (content === undefined) {
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      showToast({ type: 'success', title: `Copied ${contentName}`, description: 'The text is in your clipboard.' })
    } catch {
      showToast({ type: 'error', title: 'I couldn’t copy this text',
        description: 'Your browser did not allow clipboard access. You can download the text instead.' })
    }
  }

  function download(): void {
    if (content === undefined) {
      return
    }
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }

    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    downloadURL.current = url
    const link = document.createElement('a')
    link.href = url
    link.download = downloadFilename
    link.click()
  }

  return (
    <Dialog open={open} centered size="wide" title={title} className="activity-details-dialog"
      onClose={onClose} {...(onAfterClose ? { onAfterClose } : {})} footer={(
        <Button iconName="download" tone="muted" tooltipMessage={`Download ${contentName}`} tooltipPosition="left"
          disabled={content === undefined} onClick={download} />
      )}>
      <p className="activity-details-path">{path}</p>
      {notice}
      <div className="activity-details-toolbar">
        {toolbar}
        {canCopy && (
          <Button iconName="file-copy" tone="muted" tooltipMessage={`Copy ${contentName}`} tooltipPosition="left"
            disabled={content === undefined} onClick={() => void copy()} />
        )}
      </div>
      {children}
    </Dialog>
  )
}
