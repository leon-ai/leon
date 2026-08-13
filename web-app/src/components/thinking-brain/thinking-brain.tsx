import { DottedIcon } from '../dotted-icon'

import './thinking-brain.sass'

const BRAIN_MASK_SOURCE = '/img/logo-for-dark-bg.svg'
const BRAIN_SOURCE_WIDTH = 44
const BRAIN_SOURCE_HEIGHT = 46

interface ThinkingBrainProps {
  active?: boolean
}

export function ThinkingBrain({ active = true }: ThinkingBrainProps) {
  return (
    <DottedIcon
      active={active}
      ariaLabel={active
        ? 'Leon is thinking'
        : 'Leon thought through this response'}
      className="thinking-brain"
      maskMode="light"
      source={BRAIN_MASK_SOURCE}
      sourceHeight={BRAIN_SOURCE_HEIGHT}
      sourceWidth={BRAIN_SOURCE_WIDTH}
    />
  )
}
