import { clsx } from 'clsx'

import { Button } from '@/components/button'

import './sidebar-update-button.sass'

/**
 * Keeps the update action aligned with icon controls in either availability state.
 */
export function SidebarUpdateButton({ available = false, checking = false, updating = false, onClick }: {
  available?: boolean
  checking?: boolean
  updating?: boolean
  onClick?: () => void
}) {
  const busy = checking || updating
  const label = updating ? 'Updating…' : checking ? 'Checking for updates…' : available ? 'New update available!' : 'Check for updates'

  return <Button className={clsx('sidebar-update-button', { 'sidebar-update-button-available': available, 'sidebar-update-button-checking': busy })}
    disabled={busy} ariaBusy={busy} {...(onClick ? { onClick } : {})}
    iconName="download-cloud-2" tone="muted" ariaLabel={label} tooltipMessage={label}>
    {available ? 'New' : undefined}
  </Button>
}
