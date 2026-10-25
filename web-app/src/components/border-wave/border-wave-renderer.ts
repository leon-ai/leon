import { THEME_CHANGE_EVENT } from '@/theme'

const MILLISECONDS_PER_SECOND = 1_000
const LOOP_FRAME_INTERVAL_MS = MILLISECONDS_PER_SECOND / 30
const FRAME_TOLERANCE_MS = .5
const MAXIMUM_PIXEL_RATIO = 2
const TAIL_FRACTION = .36
const SEGMENT_COUNT = 32
const TAIL_FALLOFF = 1.6
const LOOP_FADE_FRACTION = .35
const PEAK_OPACITY = .9
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export interface BorderWaveBounds {
  width: number
  height: number
  radius: number
  inset: number
}

export interface BorderWaveOptions {
  bounds: BorderWaveBounds
  strokeWidth: number
  durationMs: number
  speedPxPerSecond: number | undefined
  repeat: boolean
  repeatPauseMs: number
  paused: boolean
}

interface WaveGeometry {
  paths: Path2D[]
  distance: number
  tailLength: number
  cornerLength: number
  movementMs: number
  cycleMs: number
  segments: Array<{ offset: number, opacity: number }>
}

export interface BorderWaveRenderer {
  update: (options: BorderWaveOptions) => void
  dispose: () => void
}

function smoothStep(value: number): number {
  const progress = Math.max(0, Math.min(1, value))

  return progress * progress * (3 - 2 * progress)
}

function createGeometry(options: BorderWaveOptions): WaveGeometry {
  const { width, height, inset } = options.bounds
  const radius = Math.max(0, Math.min(
    options.bounds.radius - inset,
    width / 2 - inset,
    height / 2 - inset
  ))
  const horizontal = Math.max(0, width / 2 - inset - radius)
  const vertical = Math.max(0, height - 2 * inset - 2 * radius)
  const cornerLength = Math.PI * radius / 2
  const sideDistance = horizontal + vertical + 2 * cornerLength
  const halfDistance = sideDistance + horizontal
  const tailLength = halfDistance * TAIL_FRACTION
  const distance = options.repeat ? sideDistance : halfDistance
  const paths = [
    [
      `M ${width / 2} ${inset}`,
      `H ${inset + radius}`,
      `A ${radius} ${radius} 0 0 0 ${inset} ${inset + radius}`,
      `V ${height - inset - radius}`,
      `A ${radius} ${radius} 0 0 0 ${inset + radius} ${height - inset}`
    ],
    [
      `M ${width / 2} ${height - inset}`,
      `H ${width - inset - radius}`,
      `A ${radius} ${radius} 0 0 0 ${width - inset} ${height - inset - radius}`,
      `V ${inset + radius}`,
      `A ${radius} ${radius} 0 0 0 ${width - inset - radius} ${inset}`
    ]
  ].map((commands) => {
    if (!options.repeat) {
      commands.push(`H ${width / 2}`)
    }

    return new Path2D(commands.join(' '))
  })
  const travelDistance = distance + (options.repeat ? 0 : tailLength)
  const movementMs = options.speedPxPerSecond === undefined
    ? options.durationMs
    : travelDistance / options.speedPxPerSecond * MILLISECONDS_PER_SECOND

  return {
    paths,
    distance,
    tailLength,
    cornerLength,
    movementMs,
    cycleMs: movementMs + (options.repeat ? options.repeatPauseMs : 0),
    segments: Array.from({ length: SEGMENT_COUNT }, (_, index) => ({
      offset: tailLength - index * tailLength / SEGMENT_COUNT,
      opacity: ((index + 1) / SEGMENT_COUNT) ** TAIL_FALLOFF
    }))
  }
}

/**
 * Paints cached border paths without per-frame DOM changes or React renders.
 * Resting, hidden and offscreen loops release their frame callbacks entirely.
 */
export function createBorderWaveRenderer(
  canvas: HTMLCanvasElement
): BorderWaveRenderer | null {
  const context = canvas.getContext('2d')

  if (context === null) {
    return null
  }

  const paint = context
  const motionPreference = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY)
  let options: BorderWaveOptions | null = null
  let geometry: WaveGeometry | null = null
  let intersectionObserver: IntersectionObserver | null = null
  let isVisible = true
  let disposed = false
  let completed = false
  let frame = 0
  let wakeTimer = 0
  let startedAt: number | null = null
  let elapsedMs = 0
  let lastDrawTime = Number.NEGATIVE_INFINITY
  let isClear = true
  let color = window.getComputedStyle(canvas).color

  function clear(): void {
    if (!isClear && options !== null) {
      paint.clearRect(0, 0, options.bounds.width, options.bounds.height)
      isClear = true
    }
  }

  function stop(): void {
    if (startedAt !== null) {
      elapsedMs += performance.now() - startedAt
      startedAt = null
    }

    window.cancelAnimationFrame(frame)
    window.clearTimeout(wakeTimer)
    frame = 0
    wakeTimer = 0
  }

  function canRun(): boolean {
    return !disposed && !completed && options !== null &&
      !options.paused && !document.hidden && !motionPreference.matches &&
      isVisible
  }

  function render(time: number): void {
    frame = 0

    if (!canRun() || options === null || geometry === null || startedAt === null) {
      stop()
      return
    }

    const elapsed = Math.max(0, elapsedMs + time - startedAt)
    const positionMs = options.repeat ? elapsed % geometry.cycleMs : elapsed

    if (positionMs >= geometry.movementMs) {
      clear()

      if (options.repeat) {
        // One wake-up replaces animation frames throughout the pause.
        wakeTimer = window.setTimeout(() => {
          wakeTimer = 0

          if (canRun()) {
            frame = window.requestAnimationFrame(render)
          }
        }, geometry.cycleMs - positionMs)
      } else {
        completed = true
        stop()
      }

      return
    }

    if (
      !options.repeat ||
      time - lastDrawTime >= LOOP_FRAME_INTERVAL_MS - FRAME_TOLERANCE_MS
    ) {
      const progress = positionMs / geometry.movementMs
      const returning = options.repeat &&
        Math.floor(elapsed / geometry.cycleMs) % 2 === 1
      const travelDistance = geometry.distance +
        (options.repeat ? 0 : geometry.tailLength)
      const head = (returning ? 1 - progress : progress) * travelDistance
      const remainingDistance = returning ? head : geometry.distance - head
      const fadeOutDistance = returning
        ? geometry.distance * LOOP_FADE_FRACTION
        : geometry.cornerLength
      // Grow into the route rather than flashing at its origin. The return
      // dissolves gradually into the midpoint before the next outward pass.
      const opacity = options.repeat
        ? PEAK_OPACITY * smoothStep(progress / LOOP_FADE_FRACTION) *
          smoothStep(remainingDistance / fadeOutDistance)
        : 1
      paint.clearRect(0, 0, options.bounds.width, options.bounds.height)

      for (const path of geometry.paths) {
        for (const segment of geometry.segments) {
          paint.globalAlpha = opacity * segment.opacity
          // The fading tail stays behind the head in either direction.
          paint.lineDashOffset = returning
            ? -head - segment.offset + geometry.tailLength / SEGMENT_COUNT
            : segment.offset - head
          paint.stroke(path)
        }
      }

      isClear = false
      lastDrawTime = time
    }

    frame = window.requestAnimationFrame(render)
  }

  function updateActivity(): void {
    const running = canRun()

    canvas.style.animationPlayState = running ? 'running' : 'paused'

    if (!running) {
      stop()
      return
    }

    if (startedAt === null) {
      startedAt = performance.now()
      lastDrawTime = Number.NEGATIVE_INFINITY
      frame = window.requestAnimationFrame(render)
    }
  }

  function updateColor(): void {
    color = window.getComputedStyle(canvas).color
    paint.strokeStyle = color
  }

  function update(next: BorderWaveOptions): void {
    stop()

    const geometryChanged = options === null || options.bounds !== next.bounds ||
      options.strokeWidth !== next.strokeWidth || options.repeat !== next.repeat ||
      options.durationMs !== next.durationMs ||
      options.speedPxPerSecond !== next.speedPxPerSecond ||
      options.repeatPauseMs !== next.repeatPauseMs

    options = next

    if (geometryChanged) {
      const previousGeometry = geometry

      geometry = createGeometry(next)

      if (next.repeat && previousGeometry !== null) {
        // A resize must retain the pass and direction already in progress.
        const pass = Math.floor(elapsedMs / previousGeometry.cycleMs)
        const position = elapsedMs % previousGeometry.cycleMs
        const nextPosition = position < previousGeometry.movementMs
          ? position / previousGeometry.movementMs * geometry.movementMs
          : geometry.movementMs + position - previousGeometry.movementMs

        elapsedMs = pass * geometry.cycleMs + Math.min(nextPosition, geometry.cycleMs)
      }

      const pixelRatio = Math.min(window.devicePixelRatio, MAXIMUM_PIXEL_RATIO)

      canvas.width = Math.ceil(next.bounds.width * pixelRatio)
      canvas.height = Math.ceil(next.bounds.height * pixelRatio)
      paint.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      paint.lineWidth = next.strokeWidth
      paint.strokeStyle = color
      paint.setLineDash([
        geometry.tailLength / SEGMENT_COUNT,
        geometry.distance * 2 + geometry.tailLength * 2
      ])
      isClear = true
    }

    if (next.repeat && intersectionObserver === null) {
      intersectionObserver = new IntersectionObserver(([entry]) => {
        isVisible = entry?.isIntersecting ?? false
        updateActivity()
      })
      intersectionObserver.observe(canvas)
    }

    updateActivity()
  }

  document.addEventListener('visibilitychange', updateActivity)
  motionPreference.addEventListener('change', updateActivity)
  window.addEventListener(THEME_CHANGE_EVENT, updateColor)

  return {
    update,
    dispose: (): void => {
      disposed = true
      stop()
      intersectionObserver?.disconnect()
      document.removeEventListener('visibilitychange', updateActivity)
      motionPreference.removeEventListener('change', updateActivity)
      window.removeEventListener(THEME_CHANGE_EVENT, updateColor)
    }
  }
}
