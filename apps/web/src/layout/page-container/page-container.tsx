import type { ReactNode } from 'react'

import './page-container.sass'

interface PageContainerProps {
  children: ReactNode
  inert?: boolean
}

export function PageContainer({
  children, inert
}: PageContainerProps) {
  return (
    <div className="page-container" inert={inert}>
      {children}
    </div>
  )
}
