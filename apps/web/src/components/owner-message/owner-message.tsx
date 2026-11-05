import { clsx } from 'clsx'

import { useAnimateOnce } from '@/components/streaming-text'
import { MessageMetadata } from '@/components/message-metadata'

import './owner-message.sass'

interface OwnerMessageProps {
  animationId: string
  children: string
  timestamp?: number | undefined
}

export function OwnerMessage({
  animationId,
  children,
  timestamp
}: OwnerMessageProps) {
  const shouldAnimate = useAnimateOnce(animationId)

  return (
    <div className="owner-message-container">
      <p className={clsx('owner-message', {
        'owner-message-animate': shouldAnimate
      })}>
        {children}
      </p>
      <MessageMetadata role="owner" text={children} timestamp={timestamp} />
    </div>
  )
}
