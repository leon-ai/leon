import { useId, type ReactNode } from 'react'

/**
 * Groups related controls under one heading and one bordered surface.
 */
export function SettingSection({ title, id, children }: { title: string, id?: string, children: ReactNode }) {
  const heading = useId()

  return <section className="setting-section" id={id} aria-labelledby={heading}>
    <h3 id={heading}>{title}</h3>
    <div className="setting-section-surface">{children}</div>
  </section>
}

/**
 * Keeps the setting's explanation and its immediate control together.
 */
export function SettingRow({ id, label, description, children }: {
  id?: string
  label: string
  description: string
  children: ReactNode
}) {
  const name = useId()

  return <div className="setting-row" id={id} aria-labelledby={name} aria-describedby={`${name}-description`} role="group">
    <div className="setting-row-copy">
      <span className="setting-row-name" id={name}>{label}</span>
      <p id={`${name}-description`}>{description}</p>
    </div>
    <div className="setting-row-controls">{children}</div>
  </div>
}
