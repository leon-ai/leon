import type { ReactNode } from 'react'
import { clsx } from 'clsx'

import './message.sass'

interface MessageProps {
  children: ReactNode
  role: 'owner' | 'leon'
}

export function Message({ children, role }: MessageProps) {
  return (
    <article className={clsx('message', `message-${role}`)}>
      {children}
    </article>
  )
}
