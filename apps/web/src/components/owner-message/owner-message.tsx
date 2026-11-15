import { clsx } from 'clsx'

import { useAnimateOnce } from '@/components/streaming-text'
import { MessageMetadata } from '@/components/message-metadata'
import { AttachmentPreviews, type AttachmentPreview } from '@/components/query-input/attachment-previews'

import './owner-message.sass'

interface OwnerMessageProps {
  animationId: string
  children: string
  timestamp?: number | undefined
  attachments?: AttachmentPreview[] | undefined
}

export function OwnerMessage({
  animationId,
  children,
  timestamp,
  attachments
}: OwnerMessageProps) {
  const shouldAnimate = useAnimateOnce(animationId)

  return (
    <div className="owner-message-container">
      {Boolean(attachments?.length) && <AttachmentPreviews items={attachments!} />}
      {children && <p className={clsx('owner-message', {
        'owner-message-animate': shouldAnimate
      })}>
        {children}
      </p>}
      <MessageMetadata role="owner" text={children} timestamp={timestamp} />
    </div>
  )
}
