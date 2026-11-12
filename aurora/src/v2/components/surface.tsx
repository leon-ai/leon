import type { ReactNode } from 'react'

import './surface.sass'

export interface SurfaceProps {
  title: string
  description?: string
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/**
 * Provides a quiet, labelled container with one shared footer for widget actions.
 */
export function Surface({ title, description, header, footer, children }: SurfaceProps) {
  return <section className="aurora-surface" aria-label={title}>
    {header ?? <header className="aurora-surface-header">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </header>}
    {children}
    {footer && <footer className="aurora-surface-footer">{footer}</footer>}
  </section>
}
