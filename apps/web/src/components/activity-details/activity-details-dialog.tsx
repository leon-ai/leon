import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'

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
  const downloadURL = useRef<string | undefined>(undefined)

  useEffect(() => (): void => {
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }
  }, [])

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
          <CopyButton text={content} tone="muted" label={`Copy ${contentName}`} tooltipPosition="left"
            disabled={!open} />
        )}
      </div>
      {children}
    </Dialog>
  )
}
