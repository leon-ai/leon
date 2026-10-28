import { useEffect, useState, type RefObject } from 'react'

import { BorderWave, type BorderWaveBounds } from '@/components/border-wave'

const WAVE_DURATION_MS = 400
const WAVE_STROKE_WIDTH_PX = 1

interface QueryInputFocusWaveProps {
  formRef: RefObject<HTMLFormElement | null>
  onComplete: () => void
}

/**
 * Sweeps both halves of the composer border once, following its current size.
 */
export function QueryInputFocusWave({
  formRef,
  onComplete
}: QueryInputFocusWaveProps) {
  const [bounds, setBounds] = useState<BorderWaveBounds | null>(null)

  useEffect(() => {
    const form = formRef.current

    if (form === null) {
      return
    }

    const observedForm = form

    function measure(): void {
      const { width, height } = observedForm.getBoundingClientRect()
      const style = window.getComputedStyle(observedForm)

      setBounds({
        width,
        height,
        radius: Number.parseFloat(style.borderTopLeftRadius),
        inset: Number.parseFloat(style.borderTopWidth) / 2
      })
    }

    // Composer expansion can change the corners during the focus sweep.
    const observer = new ResizeObserver(measure)

    observer.observe(observedForm)
    measure()

    return () => observer.disconnect()
  }, [formRef])

  if (bounds === null || bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  return (
    <BorderWave
      bounds={bounds}
      className="query-input-focus-wave"
      durationMs={WAVE_DURATION_MS}
      strokeWidth={WAVE_STROKE_WIDTH_PX}
      onComplete={onComplete}
    />
  )
}
