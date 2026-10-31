import { ProcessGroup } from '@/components/process-group'

const WORKING_LABELS = [
  'Working...',
  'On it...',
  'Right here...',
  'Let me see...',
  'Taking a peek...',
  'Just a moment...',
  'One little moment...',
  'Leave it with me...',
  'A little magic...',
  'Coming together...',
  'Getting comfy...',
  'Settling in...',
  'Warming up...',
  'Here we go...',
  'Let’s see...',
  'Tinkering away...',
  'Quietly at work...',
  'A little tinkering...',
  'I’ve got you...',
  'Just a tick...'
] as const

interface WorkingMessageProps {
  phaseId: string
}

/**
 * Keeps icon-free waiting copy stable across updates and virtualized remounts,
 * without timers or a retained label cache.
 */
export function WorkingMessage({ phaseId }: WorkingMessageProps) {
  let labelIndex = 0

  for (const character of phaseId) {
    labelIndex = (labelIndex + character.codePointAt(0)!) % WORKING_LABELS.length
  }

  return (
    <ProcessGroup
      active
      animateWhileActive
      activeLabel={WORKING_LABELS[labelIndex]!}
      ariaLabel="Leon’s work"
      completedLabel="Worked"
    />
  )
}
