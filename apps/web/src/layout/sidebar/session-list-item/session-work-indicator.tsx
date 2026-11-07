import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'

import { BorderWave, type BorderWaveBounds } from '@/components/border-wave'
import { useAnimationVisibility } from '@/hooks/use-animation-visibility'

import './session-work-indicator.sass'

const PARTICLE_COUNT = 8
const STROKE_WIDTH_PX = 1
const WAVE_SPEED_PX_PER_SECOND = 60
const WAVE_REPEAT_PAUSE_MS = 0

/**
 * Highlights a working session with tapered perimeter waves and interior particles.
 */
export function SessionWorkIndicator() {
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const [bounds, setBounds] = useState<BorderWaveBounds | null>(null)
  const isAnimating = useAnimationVisibility()

  useEffect(() => {
    const indicator = indicatorRef.current

    if (indicator === null) {
      return undefined
    }

    const observedIndicator = indicator

    function measure(): void {
      const { width, height } = observedIndicator.getBoundingClientRect()
      const radius = Number.parseFloat(
        window.getComputedStyle(observedIndicator).borderTopLeftRadius
      ) || 0

      // Use CSS geometry so the wave follows the corners as the sidebar resizes.
      setBounds((current) => {
        if (
          current?.width === width &&
          current.height === height &&
          current.radius === radius
        ) {
          return current
        }

        return { width, height, radius, inset: STROKE_WIDTH_PX / 2 }
      })
    }

    const observer = new ResizeObserver(measure)

    observer.observe(observedIndicator)
    measure()

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <span
      ref={indicatorRef}
      className={clsx('session-work-indicator', {
        'session-work-paused': !isAnimating
      })}
      aria-hidden="true"
    >
      {bounds !== null && bounds.width > 0 && bounds.height > 0 && (
        <BorderWave
          bounds={bounds}
          className="session-work-paths"
          strokeWidth={STROKE_WIDTH_PX}
          speedPxPerSecond={WAVE_SPEED_PX_PER_SECOND}
          repeat
          repeatPauseMs={WAVE_REPEAT_PAUSE_MS}
          paused={!isAnimating}
        />
      )}
      <span className="session-work-particles">
        {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
          <span key={index} className="session-work-particle" />
        ))}
      </span>
    </span>
  )
}
