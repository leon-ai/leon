import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'

import './dotted-icon.sass'

const DEFAULT_DOT_COLUMN_COUNT = 15
const DOT_OFFSET_RATIO = .5
const MASK_ALPHA_THRESHOLD = 128
const MASK_LIGHTNESS_THRESHOLD = 160
const ANIMATION_DURATION_MS = 2_800

interface DottedIconPoint {
  phase: number
  x: number
  y: number
}

interface DottedIconProps {
  active?: boolean
  ariaLabel: string
  className?: string
  columnCount?: number
  maskMode?: 'alpha' | 'light'
  source: string
  sourceHeight: number
  sourceWidth: number
}

function createDots(
  image: HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  columnCount: number,
  maskMode: DottedIconProps['maskMode']
): DottedIconPoint[] {
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = sourceWidth
  maskCanvas.height = sourceHeight
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })

  if (maskContext === null) {
    return []
  }

  maskContext.drawImage(image, 0, 0, sourceWidth, sourceHeight)
  const pixels = maskContext.getImageData(
    0,
    0,
    sourceWidth,
    sourceHeight
  ).data
  const spacing = sourceWidth / columnCount
  const offset = spacing * DOT_OFFSET_RATIO
  const dots: DottedIconPoint[] = []

  // Staggered samples preserve each silhouette while giving the wave enough
  // individual points to feel fluid at the small UI size.
  for (let y = offset; y < sourceHeight; y += spacing) {
    const rowOffset = Math.floor(y / spacing) % 2 === 0 ? 0 : spacing / 2

    for (let x = offset + rowOffset; x < sourceWidth; x += spacing) {
      const pixelIndex = (
        (Math.floor(y) * sourceWidth) + Math.floor(x)
      ) * 4
      const alpha = pixels[pixelIndex + 3] ?? 0
      const lightness = Math.max(
        pixels[pixelIndex] ?? 0,
        pixels[pixelIndex + 1] ?? 0,
        pixels[pixelIndex + 2] ?? 0
      )
      const matchesMask = maskMode === 'light'
        ? alpha >= MASK_ALPHA_THRESHOLD &&
          lightness >= MASK_LIGHTNESS_THRESHOLD
        : alpha >= MASK_ALPHA_THRESHOLD

      if (!matchesMask) {
        continue
      }

      dots.push({
        x: x / sourceWidth,
        y: y / sourceHeight,
        phase: (x * .31) + (y * .17)
      })
    }
  }

  return dots
}

/** Renders an SVG silhouette as the animated dotted activity indicator. */
export function DottedIcon({
  active = true,
  ariaLabel,
  className,
  columnCount = DEFAULT_DOT_COLUMN_COUNT,
  maskMode = 'alpha',
  source,
  sourceHeight,
  sourceWidth
}: DottedIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    const canvasElement = canvas
    const drawingContext = context
    const image = new Image()
    const reducedMotionQuery = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    )
    let animationFrame = 0
    let isVisible = true
    let dots: DottedIconPoint[] = []
    let dotColor = window.getComputedStyle(canvasElement).color

    function resizeCanvas(): void {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvasElement.getBoundingClientRect()
      canvasElement.width = Math.round(width * pixelRatio)
      canvasElement.height = Math.round(height * pixelRatio)
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    function draw(timestamp: number): void {
      const { width, height } = canvasElement.getBoundingClientRect()
      const animationProgress = active && !reducedMotionQuery.matches
        ? (timestamp % ANIMATION_DURATION_MS) / ANIMATION_DURATION_MS
        : .42
      const wavePosition = (animationProgress * 1.4) - .2

      drawingContext.clearRect(0, 0, width, height)
      drawingContext.fillStyle = dotColor

      for (const dot of dots) {
        const distanceFromWave = dot.x - wavePosition
        const waveStrength = Math.exp(
          -(distanceFromWave * distanceFromWave) * 28
        )
        const breathing = .5 +
          (.5 * Math.sin((animationProgress * Math.PI * 2) + dot.phase))
        const radius = .52 + (waveStrength * .4) + (breathing * .1)
        const verticalDrift = active && !reducedMotionQuery.matches
          ? Math.sin((animationProgress * Math.PI * 2) + dot.phase) * .35
          : 0

        drawingContext.globalAlpha =
          .42 + (waveStrength * .5) + (breathing * .08)
        drawingContext.beginPath()
        drawingContext.arc(
          dot.x * width,
          (dot.y * height) + verticalDrift,
          radius,
          0,
          Math.PI * 2
        )
        drawingContext.fill()
      }

      drawingContext.globalAlpha = 1
    }

    function stopAnimation(): void {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }

    function animate(timestamp: number): void {
      draw(timestamp)
      animationFrame = window.requestAnimationFrame(animate)
    }

    function updateAnimation(): void {
      stopAnimation()

      if (
        dots.length === 0 ||
        !active ||
        reducedMotionQuery.matches ||
        !isVisible ||
        document.visibilityState === 'hidden'
      ) {
        draw(0)
        return
      }

      animationFrame = window.requestAnimationFrame(animate)
    }

    function handleThemeChange(): void {
      dotColor = window.getComputedStyle(canvasElement).color
      draw(performance.now())
    }

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry?.isIntersecting ?? true
      updateAnimation()
    })
    const themeObserver = new MutationObserver(handleThemeChange)
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      draw(performance.now())
    })

    image.addEventListener('load', () => {
      dots = createDots(
        image,
        sourceWidth,
        sourceHeight,
        Math.max(1, columnCount),
        maskMode
      )
      resizeCanvas()
      updateAnimation()
    }, { once: true })
    image.src = source

    intersectionObserver.observe(canvasElement)
    resizeObserver.observe(canvasElement)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    reducedMotionQuery.addEventListener('change', updateAnimation)
    document.addEventListener('visibilitychange', updateAnimation)

    return () => {
      stopAnimation()
      intersectionObserver.disconnect()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      reducedMotionQuery.removeEventListener('change', updateAnimation)
      document.removeEventListener('visibilitychange', updateAnimation)
    }
  }, [active, columnCount, maskMode, source, sourceHeight, sourceWidth])

  return (
    <canvas
      ref={canvasRef}
      className={clsx('dotted-icon', className)}
      role="img"
      aria-label={ariaLabel}
    />
  )
}
