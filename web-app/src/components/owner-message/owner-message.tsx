import { clsx } from 'clsx'

import { useAnimateOnce } from '../streaming-text'

import './owner-message.sass'

interface OwnerMessageProps {
  animationId: string
  children: string
}

export function OwnerMessage({
  animationId,
  children
}: OwnerMessageProps) {
  const shouldAnimate = useAnimateOnce(animationId)

  return (
    <p className={clsx('owner-message', {
      'owner-message-animate': shouldAnimate
    })}>
      {children}
    </p>
  )
}
