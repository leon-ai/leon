import { useEffect, useRef } from 'react'

import './thinking-brain.sass'

const BRAIN_MASK_SOURCE = '/img/logo-for-dark-bg.svg'
const BRAIN_SOURCE_WIDTH = 44
const BRAIN_SOURCE_HEIGHT = 46
const BRAIN_DOT_SPACING = 3
const BRAIN_DOT_OFFSET = 1.5
const BRAIN_MASK_ALPHA_THRESHOLD = 128
const BRAIN_MASK_LIGHTNESS_THRESHOLD = 160
const BRAIN_ANIMATION_DURATION = 2_800

interface BrainDot {
  x: number
  y: number
  phase: number
}

interface ThinkingBrainProps {
  active?: boolean
}

function createBrainDots(image: HTMLImageElement): BrainDot[] {
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = BRAIN_SOURCE_WIDTH
  maskCanvas.height = BRAIN_SOURCE_HEIGHT
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })

  if (maskContext === null) {
    return []
  }

  maskContext.drawImage(image, 0, 0, BRAIN_SOURCE_WIDTH, BRAIN_SOURCE_HEIGHT)
  const pixels = maskContext.getImageData(
    0,
    0,
    BRAIN_SOURCE_WIDTH,
    BRAIN_SOURCE_HEIGHT
  ).data
  const dots: BrainDot[] = []

  // The SVG supplies only the silhouette. A staggered sample makes the mark
  // feel organic while keeping the particle layout deterministic.
  for (
    let y = BRAIN_DOT_OFFSET;
    y < BRAIN_SOURCE_HEIGHT;
    y += BRAIN_DOT_SPACING
  ) {
    const rowOffset = Math.floor(y / BRAIN_DOT_SPACING) % 2 === 0
      ? 0
      : BRAIN_DOT_SPACING / 2

    for (
      let x = BRAIN_DOT_OFFSET + rowOffset;
      x < BRAIN_SOURCE_WIDTH;
      x += BRAIN_DOT_SPACING
    ) {
      const pixelIndex = ((Math.floor(y) * BRAIN_SOURCE_WIDTH) + Math.floor(x)) * 4

      const alpha = pixels[pixelIndex + 3] ?? 0
      const lightness = Math.max(
        pixels[pixelIndex] ?? 0,
        pixels[pixelIndex + 1] ?? 0,
        pixels[pixelIndex + 2] ?? 0
      )

      // Sampling the light pixels, rather than every opaque pixel, preserves
      // the logo's internal brain linework instead of producing a solid oval.
      if (
        alpha < BRAIN_MASK_ALPHA_THRESHOLD ||
        lightness < BRAIN_MASK_LIGHTNESS_THRESHOLD
      ) {
        continue
      }

      dots.push({
        x: x / BRAIN_SOURCE_WIDTH,
        y: y / BRAIN_SOURCE_HEIGHT,
        phase: (x * .31) + (y * .17)
      })
    }
  }

  return dots
}

export function ThinkingBrain({ active = true }: ThinkingBrainProps) {
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
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animationFrame = 0
    let isVisible = true
    let dots: BrainDot[] = []
    let dotColor = window.getComputedStyle(canvasElement).color

    function resizeCanvas(): number {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvasElement.getBoundingClientRect()
      canvasElement.width = Math.round(width * pixelRatio)
      canvasElement.height = Math.round(height * pixelRatio)
      drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

      return pixelRatio
    }

    function draw(timestamp: number): void {
      const { width, height } = canvasElement.getBoundingClientRect()
      const animationProgress = active && !reducedMotionQuery.matches
        ? (timestamp % BRAIN_ANIMATION_DURATION) / BRAIN_ANIMATION_DURATION
        : .42
      const wavePosition = (animationProgress * 1.4) - .2

      drawingContext.clearRect(0, 0, width, height)
      drawingContext.fillStyle = dotColor

      for (const dot of dots) {
        const distanceFromWave = dot.x - wavePosition
        const waveStrength = Math.exp(-(distanceFromWave * distanceFromWave) * 28)
        const breathing = .5 +
          (.5 * Math.sin((animationProgress * Math.PI * 2) + dot.phase))
        const radius = .52 + (waveStrength * .4) + (breathing * .1)
        const verticalDrift = active && !reducedMotionQuery.matches
          ? Math.sin((animationProgress * Math.PI * 2) + dot.phase) * .35
          : 0

        drawingContext.globalAlpha = .42 + (waveStrength * .5) + (breathing * .08)
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
      dots = createBrainDots(image)
      resizeCanvas()
      updateAnimation()
    }, { once: true })
    image.src = BRAIN_MASK_SOURCE

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
  }, [active])

  return (
    <canvas
      ref={canvasRef}
      className="thinking-brain"
      role="img"
      aria-label={active ? 'Leon is thinking' : 'Leon thought through this response'}
    />
  )
}
