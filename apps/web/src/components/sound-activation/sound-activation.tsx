import { useEffect } from 'react'
import { unlockSounds } from '@/utils/sounds'

/**
 * Unlocks one shared audio context from gestures without a startup download.
 */
export function SoundActivation() {
  useEffect(() => {
    document.addEventListener('pointerdown', unlockSounds, { passive: true })
    document.addEventListener('keydown', unlockSounds)

    return () => {
      document.removeEventListener('pointerdown', unlockSounds)
      document.removeEventListener('keydown', unlockSounds)
    }
  }, [])

  return null
}
