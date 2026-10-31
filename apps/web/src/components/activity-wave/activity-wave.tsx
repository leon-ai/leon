import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { clsx } from 'clsx'

import './activity-wave.sass'

const ACTIVITY_WAVE_SPEED_PX_PER_SECOND = 120
const ACTIVITY_WAVE_ANIMATION_NAME = 'activity-wave'
const MILLISECONDS_PER_SECOND = 1_000
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

interface ActivityWaveProps {
  active: boolean
  children: ReactNode
  className?: string
}

interface ActivityWaveMetrics {
  bounds: DOMRect
  durationSeconds: number
  highlightWidth: number
  travelFraction: number
}

/**
 * Maps the heading's sweep into SVG stroke coordinates using its animation clock.
 */
function animateSvgStrokes(
  heading: HTMLSpanElement,
  metrics: ActivityWaveMetrics,
  style: CSSStyleDeclaration,
  waveId: string
): (() => void) | undefined {
  const strokes = heading.querySelectorAll<SVGGraphicsElement>(
    'svg [stroke="currentColor"]'
  )

  if (strokes.length === 0) {
    return undefined
  }

  const waveAnimation = heading.getAnimations().find((animation) =>
    (animation as CSSAnimation).animationName === ACTIVITY_WAVE_ANIMATION_NAME
  )

  if (waveAnimation === undefined) {
    return undefined
  }

  const cleanupTasks: Array<() => void> = []
  const highlights: Array<{
    animation: SVGAnimateTransformElement
    gradientId: string
    stroke: SVGGraphicsElement
  }> = []
  const stops = [
    ['0%', 'var(--color-text-secondary)'],
    [
      style.getPropertyValue('--activity-wave-highlight-start'),
      'var(--activity-wave-highlight-color)'
    ],
    [
      style.getPropertyValue('--activity-wave-highlight-end'),
      'var(--activity-wave-highlight-color)'
    ],
    ['100%', 'var(--color-text-secondary)']
  ] as const
  let cancelled = false

  for (const [index, stroke] of strokes.entries()) {
    const svg = stroke.ownerSVGElement
    const transform = stroke.getScreenCTM()

    if (
      svg === null ||
      transform === null ||
      transform.a * transform.d === transform.b * transform.c
    ) {
      continue
    }

    // Inverting each stroke's matrix preserves alignment through icon transforms.
    const inverse = transform.inverse()
    const start = new DOMPoint(
      metrics.bounds.left - metrics.highlightWidth,
      metrics.bounds.top
    ).matrixTransform(inverse)
    const end = new DOMPoint(
      metrics.bounds.left,
      metrics.bounds.top
    ).matrixTransform(inverse)
    const distance = metrics.bounds.width + metrics.highlightWidth
    const translation = `${inverse.a * distance} ${inverse.b * distance}`
    const gradientId = `${waveId}-stroke-${index}`
    const defs = document.createElementNS(SVG_NAMESPACE, 'defs')
    const gradient = document.createElementNS(SVG_NAMESPACE, 'linearGradient')
    const animation = document.createElementNS(SVG_NAMESPACE, 'animateTransform')
    const previousStroke = stroke.style.stroke

    gradient.id = gradientId
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse')
    gradient.setAttribute('x1', String(start.x))
    gradient.setAttribute('y1', String(start.y))
    gradient.setAttribute('x2', String(end.x))
    gradient.setAttribute('y2', String(end.y))

    for (const [offset, color] of stops) {
      const stop = document.createElementNS(SVG_NAMESPACE, 'stop')

      stop.setAttribute('offset', offset)
      stop.setAttribute('stop-color', color)
      gradient.appendChild(stop)
    }

    animation.setAttribute('attributeName', 'gradientTransform')
    animation.setAttribute('type', 'translate')
    animation.setAttribute('values', `0 0;${translation};${translation}`)
    animation.setAttribute('keyTimes', `0;${metrics.travelFraction};1`)
    animation.setAttribute('dur', `${metrics.durationSeconds}s`)
    animation.setAttribute('repeatCount', 'indefinite')
    animation.setAttribute('begin', 'indefinite')
    gradient.appendChild(animation)
    defs.appendChild(gradient)
    svg.appendChild(defs)
    highlights.push({ animation, gradientId, stroke })
    cleanupTasks.push(() => {
      stroke.style.stroke = previousStroke
      defs.remove()
    })
  }

  function cleanup(): void {
    cancelled = true
    cleanupTasks.forEach((task) => task())
  }

  // The CSS clock is ready before sampling its phase, including after a resize.
  void waveAnimation.ready.then(() => {
    if (cancelled) {
      return
    }

    const elapsedSeconds = Number(waveAnimation.currentTime ?? 0) /
      MILLISECONDS_PER_SECOND
    const offset = -(elapsedSeconds % metrics.durationSeconds)

    for (const { animation, gradientId, stroke } of highlights) {
      animation.beginElementAt(offset)
      stroke.style.stroke = `url(#${gradientId})`
    }
  }).catch(cleanup)

  return cleanup
}

/**
 * Highlights an active heading at a consistent speed across its rendered width.
 */
export function ActivityWave({
  active,
  children,
  className
}: ActivityWaveProps) {
  const waveId = useId()
  const headingRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const heading = headingRef.current

    if (!active || heading === null) {
      return undefined
    }

    const observedHeading = heading
    const reducedMotion = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY)
    let cleanupSvgStrokes: (() => void) | undefined

    function updateWaveDuration(): void {
      cleanupSvgStrokes?.()
      cleanupSvgStrokes = undefined

      const bounds = observedHeading.getBoundingClientRect()
      const width = bounds.width
      const style = window.getComputedStyle(observedHeading)
      const highlightWidth = Number.parseFloat(
        style.getPropertyValue('--activity-wave-highlight-width')
      )
      const travelFraction = Number.parseFloat(
        style.getPropertyValue('--activity-wave-travel-fraction')
      )

      if (
        width <= 0 ||
        !Number.isFinite(highlightWidth) ||
        !Number.isFinite(travelFraction) ||
        travelFraction <= 0
      ) {
        return
      }

      // Include the band's offscreen travel and preserve the pause after its pass.
      const durationSeconds = (width + highlightWidth) /
        ACTIVITY_WAVE_SPEED_PX_PER_SECOND / travelFraction

      observedHeading.style.setProperty(
        '--activity-wave-duration',
        `${durationSeconds}s`
      )

      if (!reducedMotion.matches) {
        cleanupSvgStrokes = animateSvgStrokes(observedHeading, {
          bounds,
          durationSeconds,
          highlightWidth,
          travelFraction
        }, style, waveId)
      }
    }

    updateWaveDuration()

    const resizeObserver = new ResizeObserver(updateWaveDuration)
    resizeObserver.observe(observedHeading)
    reducedMotion.addEventListener('change', updateWaveDuration)

    return () => {
      resizeObserver.disconnect()
      reducedMotion.removeEventListener('change', updateWaveDuration)
      cleanupSvgStrokes?.()
    }
  }, [active, waveId])

  return (
    <span
      ref={headingRef}
      className={clsx('activity-wave', className, {
        'activity-wave-active': active
      })}
    >
      {children}
    </span>
  )
}
