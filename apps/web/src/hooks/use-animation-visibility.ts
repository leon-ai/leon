import { useSyncExternalStore } from 'react'

import { getAnimationVisibility, subscribeAnimationVisibility } from '@/utils/animation-visibility'

/**
 * Shares the document's decorative-motion lifecycle across mounted components.
 */
export function useAnimationVisibility(): boolean {
  return useSyncExternalStore(subscribeAnimationVisibility, getAnimationVisibility)
}
