import { Icon } from '@/components/icon'
import { ProcessGroup } from '@/components/process-group'
import { getActivityLabel } from '@/data/activity-labels'

interface WorkingMessageProps {
  phaseId: string
  label?: string
  iconName?: string
  ariaLabel?: string
  startedAt?: number | undefined
}

/**
 * Reuses one status row through waiting and known model phases, without timers
 * or a retained label cache. Generic waiting remains icon-free.
 */
export function WorkingMessage({ phaseId, label, iconName, startedAt, ariaLabel }: WorkingMessageProps) {
  return (
    <ProcessGroup
      active
      startedAt={startedAt}
      animateWhileActive
      activeLabel={label ?? getActivityLabel(phaseId)}
      ariaLabel={ariaLabel ?? (iconName ? 'Leon’s inference' : 'Leon’s work')}
      completedLabel="Worked"
      indicator={iconName ? <Icon name={`${iconName}`} /> : undefined}
    />
  )
}
