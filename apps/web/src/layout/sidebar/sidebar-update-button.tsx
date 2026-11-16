import { clsx } from 'clsx'

import { Button } from '@/components/button'

import './sidebar-update-button.sass'

/**
 * Keeps the update action aligned with icon controls in either availability state.
 */
export function SidebarUpdateButton({ available = false }: { available?: boolean }) {
  const label = available ? 'New update available!' : 'Check for updates'

  return <Button className={clsx('sidebar-update-button', { 'sidebar-update-button-available': available })}
    iconName="download-cloud-2" tone="muted" ariaLabel={label} tooltipMessage={label}>
    {available ? 'New' : undefined}
  </Button>
}
