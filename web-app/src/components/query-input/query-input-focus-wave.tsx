import { useId, useLayoutEffect, useState, type RefObject } from 'react'

const WAVE_DURATION_MS = 1_000
const WAVE_STROKE_WIDTH_PX = 1
const WAVE_TAIL_FRACTION = .36
const WAVE_SEGMENT_COUNT = 32
const WAVE_TAIL_FALLOFF = 1.6

interface BorderBounds {
  width: number
  height: number
  radius: number
  strokeWidth: number
}

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
  const waveId = useId()
  const [bounds, setBounds] = useState<BorderBounds | null>(null)

  useLayoutEffect(() => {
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
        strokeWidth: Number.parseFloat(style.borderTopWidth)
      })
    }

    // Composer expansion can change the corners during the focus sweep.
    const observer = new ResizeObserver(measure)

    observer.observe(observedForm)
    measure()

    return () => observer.disconnect()
  }, [formRef])

  const inset = (bounds?.strokeWidth ?? 0) / 2
  const width = bounds?.width ?? 0
  const height = bounds?.height ?? 0
  const radius = Math.max(0, Math.min(
    (bounds?.radius ?? 0) - inset,
    width / 2 - inset,
    height / 2 - inset
  ))
  const leftPath = [
    `M ${width / 2} ${inset}`,
    `H ${inset + radius}`,
    `A ${radius} ${radius} 0 0 0 ${inset} ${inset + radius}`,
    `V ${height - inset - radius}`,
    `A ${radius} ${radius} 0 0 0 ${inset + radius} ${height - inset}`,
    `H ${width / 2}`
  ].join(' ')
  const rightPath = [
    `M ${width / 2} ${height - inset}`,
    `H ${width - inset - radius}`,
    `A ${radius} ${radius} 0 0 0 ${width - inset} ${height - inset - radius}`,
    `V ${inset + radius}`,
    `A ${radius} ${radius} 0 0 0 ${width - inset - radius} ${inset}`,
    `H ${width / 2}`
  ].join(' ')
  const paths = [leftPath, rightPath]
  const segmentLength = WAVE_TAIL_FRACTION / WAVE_SEGMENT_COUNT
  const travelDistance = 1 + WAVE_TAIL_FRACTION

  return (
    <svg
      className="query-input-focus-wave"
      aria-hidden="true"
      width="100%"
      height="100%"
      style={{ animationDuration: `${WAVE_DURATION_MS}ms` }}
      onAnimationEnd={onComplete}
    >
      {bounds !== null && width > 0 && height > 0 && (
        <>
          <defs>
            {paths.map((path, index) => (
              <path
                key={index}
                id={`${waveId}-${index}`}
                d={path}
                pathLength="1"
              />
            ))}
          </defs>
          {paths.map((_, pathIndex) => (
            <g
              key={pathIndex}
              fill="none"
              stroke="currentColor"
              strokeWidth={WAVE_STROKE_WIDTH_PX}
              strokeDasharray={`${segmentLength} ${1 + travelDistance}`}
            >
              {Array.from({ length: WAVE_SEGMENT_COUNT }, (_, index) => {
                const offset = WAVE_TAIL_FRACTION - index * segmentLength
                const intensity = (index + 1) / WAVE_SEGMENT_COUNT

                // Short adjacent dashes form a tail along the actual perimeter.
                // Traveling past the endpoint lets it drain away after the head.
                return (
                  <use
                    key={index}
                    href={`#${waveId}-${pathIndex}`}
                    strokeOpacity={intensity ** WAVE_TAIL_FALLOFF}
                    strokeDashoffset={offset}
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from={offset}
                      to={offset - travelDistance}
                      dur={`${WAVE_DURATION_MS}ms`}
                      repeatCount="1"
                      fill="freeze"
                    />
                  </use>
                )
              })}
            </g>
          ))}
        </>
      )}
    </svg>
  )
}
