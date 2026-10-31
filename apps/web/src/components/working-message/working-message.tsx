import { ProcessGroup } from '@/components/process-group'
import { getActivityLabel } from '@/data/activity-labels'

interface WorkingMessageProps {
  phaseId: string
  label?: string
  iconName?: string
}

/**
 * Reuses one status row through waiting and known model phases, without timers
 * or a retained label cache. Generic waiting remains icon-free.
 */
export function WorkingMessage({ phaseId, label, iconName }: WorkingMessageProps) {
  return (
    <ProcessGroup
      active
      animateWhileActive
      activeLabel={label ?? getActivityLabel(phaseId)}
      ariaLabel={iconName ? 'Leon’s inference' : 'Leon’s work'}
      completedLabel="Worked"
      indicator={iconName ? <i className={`ri-${iconName}`} aria-hidden="true" /> : undefined}
    />
  )
}
