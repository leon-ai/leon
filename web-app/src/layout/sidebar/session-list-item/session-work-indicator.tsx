import { useId, useLayoutEffect, useRef, useState } from 'react'

import './session-work-indicator.sass'

const STROKE_WIDTH_PX = 1
const PATH_END_HEIGHT_FRACTION = .75
const WAVE_RADIUS_PX = 28
const WAVE_SPEED_PX_PER_SECOND = 60
const WAVE_EASING = '.42 0 .58 1'
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

interface IndicatorBounds {
  width: number
  height: number
  radius: number
}

/**
 * Highlights a working session with one perimeter wave.
 */
export function SessionWorkIndicator() {
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const pathsRef = useRef<SVGSVGElement>(null)
  const gradientId = useId()
  const [bounds, setBounds] = useState<IndicatorBounds | null>(null)
  const [isAnimating, setIsAnimating] = useState(() =>
    !document.hidden &&
    !window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
  )

  useLayoutEffect(() => {
    const indicator = indicatorRef.current

    if (indicator === null) {
      return undefined
    }

    const observedIndicator = indicator
    const motionPreference = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY)

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

        return { width, height, radius }
      })
    }

    function updateVisibility(): void {
      setIsAnimating(!document.hidden && !motionPreference.matches)
    }

    const observer = new ResizeObserver(measure)

    observer.observe(observedIndicator)
    document.addEventListener('visibilitychange', updateVisibility)
    motionPreference.addEventListener('change', updateVisibility)
    measure()
    updateVisibility()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', updateVisibility)
      motionPreference.removeEventListener('change', updateVisibility)
    }
  }, [])

  useLayoutEffect(() => {
    const svg = pathsRef.current

    if (svg === null) {
      return
    }

    // Pause native SVG motion while the document is hidden or motion is reduced.
    if (isAnimating) {
      svg.unpauseAnimations()
    } else {
      svg.pauseAnimations()
    }
  }, [bounds, isAnimating])

  const inset = STROKE_WIDTH_PX / 2
  const endY = (bounds?.height ?? 0) * PATH_END_HEIGHT_FRACTION
  const radius = Math.max(
    0,
    Math.min(
      (bounds?.radius ?? 0) - inset,
      endY - inset,
      (bounds?.width ?? 0) / 2 - inset
    )
  )
  const wavePath = bounds === null ? '' : [
    `M ${inset} ${endY}`,
    `V ${inset + radius}`,
    `A ${radius} ${radius} 0 0 1 ${inset + radius} ${inset}`,
    `H ${bounds.width - inset - radius}`,
    `A ${radius} ${radius} 0 0 1 ${bounds.width - inset} ${inset + radius}`,
    `V ${endY}`
  ].join(' ')
  const pathDistance = Math.max(
    STROKE_WIDTH_PX,
    (bounds?.width ?? 0) - inset * 2 - radius * 2 +
    Math.PI * radius + Math.max(0, endY - inset - radius) * 2
  )
  const waveDuration = `${pathDistance / WAVE_SPEED_PX_PER_SECOND}s`
  const waveId = `${gradientId}-wave`
  const maskId = `${gradientId}-mask`

  return (
    <span
      ref={indicatorRef}
      className="session-work-indicator"
      aria-hidden="true"
    >
      {bounds !== null && bounds.width > 0 && bounds.height > 0 && (
        <svg
          ref={pathsRef}
          className="session-work-paths"
          width="100%"
          height="100%"
        >
          <defs>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={inset}
              x2="0"
              y2={endY}
            >
              <stop offset="0%" stopColor="currentColor" />
              <stop offset="45%" stopColor="currentColor" stopOpacity=".85" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={waveId}>
              <stop offset="0%" stopColor="#FFF" />
              <stop offset="35%" stopColor="#FFF" stopOpacity=".9" />
              <stop offset="100%" stopColor="#FFF" stopOpacity="0" />
            </radialGradient>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={bounds.width}
              height={bounds.height}
            >
              <circle r={WAVE_RADIUS_PX} fill={`url(#${waveId})`}>
                <animateMotion
                  path={wavePath}
                  dur={waveDuration}
                  keyPoints="0;1"
                  keyTimes="0;1"
                  calcMode="spline"
                  keySplines={WAVE_EASING}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;.1;.8;1"
                  dur={waveDuration}
                  repeatCount="indefinite"
                />
              </circle>
            </mask>
          </defs>
          <path
            className="session-work-path session-work-wave"
            d={wavePath}
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE_WIDTH_PX}
            mask={`url(#${maskId})`}
          />
        </svg>
      )}
    </span>
  )
}
