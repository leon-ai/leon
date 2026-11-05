import { useLayoutEffect, useRef } from 'react'

import type { MorphFrames, MorphPose } from './icon-morphs'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const MILLISECONDS_PER_SECOND = 1_000

interface Motion {
  from: readonly MorphPose[]
  to: readonly MorphPose[]
  startedAt: number
  duration: number
}

function toPath(pose: MorphPose): string {
  return [pose.points, ...pose.subpaths ?? []].map((points) =>
    `M${points[0]} ${points[1]}C${points.slice(2).join(' ')}`
  ).join('')
}

function currentPoses(motion: Motion, now: number): readonly MorphPose[] {
  const progress = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration))

  return motion.to.map((pose, index) => {
    const from = motion.from[index]!

    return {
      points: pose.points.map((point, pointIndex) => from.points[pointIndex]! + (point - from.points[pointIndex]!) * progress),
      subpaths: (pose.subpaths ?? []).map((points, contourIndex) => points.map((point, pointIndex) => {
        const previous = from.subpaths![contourIndex]![pointIndex]!

        return previous + (point - previous) * progress
      })),
      opacity: from.opacity + (pose.opacity - from.opacity) * progress,
      fill: from.fill + (pose.fill - from.fill) * progress,
      stroke: (from.stroke ?? 1) + ((pose.stroke ?? 1) - (from.stroke ?? 1)) * progress
    }
  })
}

/**
 * Animates explicit states with native SVG motion, including interrupted reversals.
 * Geometry is sampled only when state changes, never in a JavaScript frame loop.
 */
export function MorphPaths({ frames, state }: { frames: MorphFrames, state: string }) {
  const target = frames[state]!
  const groupRef = useRef<SVGGElement>(null)
  const previous = useRef(target)
  const motionRef = useRef<Motion | undefined>(undefined)

  useLayoutEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    const last = previous.current
    previous.current = target

    if (!group || !svg || target === last) {
      return
    }

    const now = svg.getCurrentTime()
    const from = motionRef.current ? currentPoses(motionRef.current, now) : last
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY)
    const durationValue = getComputedStyle(svg).getPropertyValue('--transition-duration-main').trim()
    const duration = Number.parseFloat(durationValue) / (durationValue.endsWith('ms') ? MILLISECONDS_PER_SECOND : 1)
    motionRef.current = undefined

    if (reducedMotion.matches || document.hidden || !Number.isFinite(duration) || duration <= 0) {
      return
    }

    const animations = Array.from(group.querySelectorAll('animate'))
    const paths = Array.from(group.children)

    for (const [index, path] of paths.entries()) {
      const start = from[index]!
      const end = target[index]!
      const values = {
        d: [toPath(start), toPath(end)],
        opacity: [String(start.opacity), String(end.opacity)],
        'fill-opacity': [String(start.fill), String(end.fill)],
        'stroke-opacity': [String(start.stroke ?? 1), String(end.stroke ?? 1)]
      }

      for (const animation of path.querySelectorAll('animate')) {
        const property = animation.getAttribute('attributeName') as keyof typeof values
        animation.setAttribute('from', values[property][0]!)
        animation.setAttribute('to', values[property][1]!)
        animation.setAttribute('dur', `${duration}s`)
      }
    }

    function showPose(poses: readonly MorphPose[]): void {
      for (const [index, path] of paths.entries()) {
        const pose = poses[index]!
        path.setAttribute('d', toPath(pose))
        path.setAttribute('opacity', String(pose.opacity))
        path.setAttribute('fill-opacity', String(pose.fill))
        path.setAttribute('stroke-opacity', String(pose.stroke ?? 1))
      }
    }

    motionRef.current = { from, to: target, startedAt: now, duration }
    animations.forEach((animation) => animation.beginElement())

    function finish(): void {
      animations.forEach((animation) => animation.endElement())
    }

    function reduce(): void {
      showPose(target)
      motionRef.current = undefined
      finish()
    }

    reducedMotion.addEventListener('change', reduce)

    return () => {
      reducedMotion.removeEventListener('change', reduce)
      // Keep the sampled timeline for a rapid state reversal, but stop native work.
      finish()
    }
  }, [target])

  return (
    <g ref={groupRef} data-icon-state={state}>
      {target.map((pose, index) => (
        <path key={index} d={toPath(pose)} opacity={pose.opacity} fillOpacity={pose.fill} strokeOpacity={pose.stroke ?? 1}
          stroke="currentColor" fill="currentColor">
          <animate attributeName="d" begin="indefinite" fill="remove" />
          <animate attributeName="opacity" begin="indefinite" fill="remove" />
          <animate attributeName="fill-opacity" begin="indefinite" fill="remove" />
          <animate attributeName="stroke-opacity" begin="indefinite" fill="remove" />
        </path>
      ))}
    </g>
  )
}
