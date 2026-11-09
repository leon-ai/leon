import type { ReactNode } from 'react'

export function VisualLayout({ children }: { identity: string, estimatedHeight?: string, ready: boolean, label?: string, children: ReactNode }) {
  return <>{children}</>
}
