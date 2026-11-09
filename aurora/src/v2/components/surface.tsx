import type { ReactNode } from 'react'

import './surface.sass'

export interface SurfaceProps {
  title: string
  description?: string
  children: ReactNode
}

/**
 * Provides a quiet, labelled container for an interactive part of an answer.
 */
export function Surface({ title, description, children }: SurfaceProps) {
  return <section className="aurora-surface" aria-label={title}>
    <header className="aurora-surface-header">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </header>
    {children}
  </section>
}
