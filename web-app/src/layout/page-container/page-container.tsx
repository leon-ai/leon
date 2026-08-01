import type { ReactNode } from 'react'

import './page-container.sass'

interface PageContainerProps {
  children: ReactNode
}

export function PageContainer({
  children
}: PageContainerProps) {
  return (
    <div className="page-container">
      {children}
    </div>
  )
}
