import { useEffect, useRef } from 'react'

import type { VibeWeatherCondition } from '../vibes-scenes'

import './weather-layer.sass'

const DEVICE_PIXEL_RATIO_LIMIT = 2
const EXIT_FADE_DISTANCE_PX = 32
const MAXIMUM_FRAME_DELTA_SECONDS = .04
const PARTICLE_AREA_PX = 3_400
const PARTICLE_COUNT_MINIMUM = 24
const PARTICLE_COUNT_MAXIMUM = 96
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SPAWN_FADE_DURATION_SECONDS = .22

type WeatherAnimationKind = 'rain' | 'snow'

interface WeatherAnimationConfig {
  density: number
  kind: WeatherAnimationKind
  opacity: number
  seed: number
  speed: number
}

const WEATHER_ANIMATIONS: Partial<
  Record<VibeWeatherCondition, WeatherAnimationConfig>
> = {
  drizzle: {
    density: .58,
    kind: 'rain',
    opacity: .62,
    seed: 1_021,
    speed: .72
  },
  rain: {
    density: 1,
    kind: 'rain',
    opacity: 1,
    seed: 2_047,
    speed: 1
  },
  storm: {
    density: 1.32,
    kind: 'rain',
    opacity: 1.15,
    seed: 4_093,
    speed: 1.24
  },
  snow: {
    density: 1,
    kind: 'snow',
    opacity: 1,
    seed: 8_191,
    speed: 1
  }
}

interface WeatherLayerProps {
  weather: VibeWeatherCondition
}

interface WeatherParticle {
  age: number
  depth: number
  drift: number
  length: number
  opacity: number
  phase: number
  size: number
  speed: number
  x: number
  y: number
}

function createSeededRandom(seed: number): () => number {
  let state = seed

  // A deterministic generator prevents the weather pattern from changing
  // whenever React mounts the same environmental scene again.
  return () => {
    state += 0x6D2B_79F5
    let value = state

    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)

    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

function createParticle(
  animation: WeatherAnimationConfig,
  width: number,
  height: number,
  random: () => number,
  distributeVertically: boolean
): WeatherParticle {
  const depth = .35 + random() * .65

  if (animation.kind === 'rain') {
    return {
      age: distributeVertically ? SPAWN_FADE_DURATION_SECONDS : 0,
      depth,
      drift: -42 - random() * 54,
      length: 7 + random() * 16,
      opacity: (.12 + depth * .3) * animation.opacity,
      phase: random() * Math.PI * 2,
      size: .65 + depth,
      speed: (420 + depth * 620) * animation.speed,
      x: random() * width,
      y: distributeVertically ? random() * height : -24 - random() * height
    }
  }

  return {
    age: distributeVertically ? SPAWN_FADE_DURATION_SECONDS : 0,
    depth,
    drift: -7 + random() * 14,
    length: 0,
    opacity: (.22 + depth * .48) * animation.opacity,
    phase: random() * Math.PI * 2,
    size: .65 + depth * 1.65,
    speed: (16 + depth * 42) * animation.speed,
    x: random() * width,
    y: distributeVertically ? random() * height : -8 - random() * height * .2
  }
}

function getParticleCount(
  width: number,
  height: number,
  density: number
): number {
  return Math.min(
    PARTICLE_COUNT_MAXIMUM,
    Math.max(PARTICLE_COUNT_MINIMUM, Math.round(
      width * height / PARTICLE_AREA_PX * density
    ))
  )
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function WeatherLayer({ weather }: WeatherLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const animation = WEATHER_ANIMATIONS[weather]

    if (canvas === null || animation === undefined) {
      return undefined
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return undefined
    }

    const canvasElement = canvas
    const activeAnimation = animation
    const renderingContext = context
    const motionPreference = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY)
    const random = createSeededRandom(activeAnimation.seed)
    let animationFrame: number | null = null
    let height = 0
    let particles: WeatherParticle[] = []
    let previousTime = 0
    let width = 0

    function resetParticle(particle: WeatherParticle): void {
      const nextParticle = createParticle(
        activeAnimation,
        width,
        height,
        random,
        false
      )

      Object.assign(particle, nextParticle)
    }

    function drawFrame(deltaSeconds: number, timeSeconds: number): void {
      renderingContext.clearRect(0, 0, width, height)

      for (const particle of particles) {
        particle.age += deltaSeconds
        const spawnOpacity = clampOpacity(
          particle.age / SPAWN_FADE_DURATION_SECONDS
        )

        if (activeAnimation.kind === 'rain') {
          particle.x += particle.drift * deltaSeconds
          particle.y += particle.speed * deltaSeconds

          if (particle.y - particle.length > height || particle.x < -24) {
            resetParticle(particle)
            particle.x += width * .1
          }

          const exitOpacity = clampOpacity(
            (height - (particle.y - particle.length)) /
            EXIT_FADE_DISTANCE_PX
          )
          const entryOpacity = clampOpacity(
            (particle.y + particle.length) / EXIT_FADE_DISTANCE_PX
          )
          const horizontalExitOpacity = clampOpacity(
            (particle.x + 24) / EXIT_FADE_DISTANCE_PX
          )
          const opacity = particle.opacity * spawnOpacity * entryOpacity *
            exitOpacity * horizontalExitOpacity

          renderingContext.beginPath()
          renderingContext.lineCap = 'round'
          renderingContext.lineWidth = particle.size
          renderingContext.strokeStyle = `rgba(167, 179, 200, ${opacity})`
          renderingContext.moveTo(particle.x, particle.y)
          renderingContext.lineTo(
            particle.x - particle.length * .28,
            particle.y + particle.length
          )
          renderingContext.stroke()
          continue
        }

        const snowDrift = Math.sin(timeSeconds * .9 + particle.phase) * 8

        particle.x += (particle.drift + snowDrift) * deltaSeconds
        particle.y += particle.speed * deltaSeconds

        if (
          particle.y - particle.size > height ||
          particle.x < -8 ||
          particle.x > width + 8
        ) {
          resetParticle(particle)
        }

        const verticalExitOpacity = clampOpacity(
          (height - (particle.y - particle.size)) / EXIT_FADE_DISTANCE_PX
        )
        const verticalEntryOpacity = clampOpacity(
          (particle.y + particle.size) / EXIT_FADE_DISTANCE_PX
        )
        const horizontalExitOpacity = Math.min(
          clampOpacity((particle.x + 8) / EXIT_FADE_DISTANCE_PX),
          clampOpacity((width + 8 - particle.x) / EXIT_FADE_DISTANCE_PX)
        )
        const opacity = particle.opacity * spawnOpacity *
          verticalEntryOpacity * verticalExitOpacity * horizontalExitOpacity

        renderingContext.beginPath()
        renderingContext.fillStyle = `rgba(245, 245, 247, ${opacity})`
        renderingContext.arc(
          particle.x,
          particle.y,
          particle.size,
          0,
          Math.PI * 2
        )
        renderingContext.fill()
      }
    }

    function render(time: number): void {
      const deltaSeconds = previousTime === 0
        ? 0
        : Math.min(
          (time - previousTime) / 1_000,
          MAXIMUM_FRAME_DELTA_SECONDS
        )

      previousTime = time
      drawFrame(deltaSeconds, time / 1_000)
      animationFrame = window.requestAnimationFrame(render)
    }

    function stopAnimation(): void {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
    }

    function startAnimation(): void {
      stopAnimation()
      previousTime = 0

      if (document.hidden || motionPreference.matches) {
        drawFrame(0, 0)
        return
      }

      animationFrame = window.requestAnimationFrame(render)
    }

    function resizeCanvas(): void {
      const bounds = canvasElement.getBoundingClientRect()
      const pixelRatio = Math.min(
        window.devicePixelRatio,
        DEVICE_PIXEL_RATIO_LIMIT
      )

      width = bounds.width
      height = bounds.height
      canvasElement.width = Math.round(width * pixelRatio)
      canvasElement.height = Math.round(height * pixelRatio)
      renderingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      particles = Array.from(
        {
          length: getParticleCount(
            width,
            height,
            activeAnimation.density
          )
        },
        () => createParticle(activeAnimation, width, height, random, true)
      )
      startAnimation()
    }

    function handleVisibilityChange(): void {
      startAnimation()
    }

    const resizeObserver = new ResizeObserver(resizeCanvas)

    resizeObserver.observe(canvasElement)
    motionPreference.addEventListener('change', startAnimation)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    resizeCanvas()

    return () => {
      stopAnimation()
      resizeObserver.disconnect()
      motionPreference.removeEventListener('change', startAnimation)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [weather])

  if (WEATHER_ANIMATIONS[weather] === undefined) {
    return null
  }

  return <canvas ref={canvasRef} className="weather-layer" />
}
