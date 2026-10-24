import { useEffect, useRef } from 'react'

import type { VibeWeatherCondition } from '@/components/vibes/vibes-scenes'

import './weather-layer.sass'

const DEVICE_PIXEL_RATIO_LIMIT = 2
const ENTRY_FADE_DISTANCE_PX = 32
const GLASS_DROPLET_AREA_PX = 10_000
const GLASS_DROPLET_COUNT_MAXIMUM = 36
const GLASS_DROPLET_COUNT_MINIMUM = 8
const MAXIMUM_FRAME_DELTA_SECONDS = .04
const PARTICLE_AREA_PX = 3_400
const PARTICLE_COUNT_MINIMUM = 24
const PARTICLE_COUNT_MAXIMUM = 180
const RAIN_PARTICLE_OPACITY_MULTIPLIER = 1.15
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SPAWN_FADE_DURATION_SECONDS = .22

type WeatherAnimationKind = 'rain' | 'snow'

interface WeatherAnimationConfig {
  density: number
  glassDensity: number
  kind: WeatherAnimationKind
  opacity: number
  seed: number
  speed: number
}

const WEATHER_ANIMATIONS: Partial<
  Record<VibeWeatherCondition, WeatherAnimationConfig>
> = {
  drizzle: {
    density: .9,
    glassDensity: .48,
    kind: 'rain',
    opacity: .62,
    seed: 1_021,
    speed: .4
  },
  rain: {
    density: 1.6,
    glassDensity: 1,
    kind: 'rain',
    opacity: 1,
    seed: 2_047,
    speed: .55
  },
  storm: {
    density: 2,
    glassDensity: 1.25,
    kind: 'rain',
    opacity: 1.15,
    seed: 4_093,
    speed: .78
  },
  snow: {
    density: 1.65,
    glassDensity: .8,
    kind: 'snow',
    opacity: 1,
    seed: 8_191,
    speed: .68
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

interface GlassDroplet {
  age: number
  baseY: number
  holdDuration: number
  opacity: number
  radius: number
  slideDistance: number
  slideDuration: number
  slides: boolean
  x: number
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
  const age = distributeVertically ? SPAWN_FADE_DURATION_SECONDS : 0

  if (animation.kind === 'rain') {
    return {
      age,
      depth,
      drift: (-18 - random() * 30) * animation.speed,
      length: 4 + random() * 9,
      opacity: (.115 + depth * .23) * animation.opacity *
        RAIN_PARTICLE_OPACITY_MULTIPLIER,
      phase: random() * Math.PI * 2,
      size: .35 + depth * .5 + random() * .15,
      speed: (90 + depth * 180) * animation.speed,
      x: random() * width,
      y: distributeVertically ? random() * height : -24 - random() * height
    }
  }

  return {
    age,
    depth,
    drift: -5 + random() * 10,
    length: 0,
    opacity: (.2 + depth * .42) * animation.opacity,
    phase: random() * Math.PI * 2,
    size: .25 + depth * .65 + random() * .35,
    speed: (9 + depth * 27) * animation.speed,
    x: random() * width,
    y: distributeVertically ? random() * height : -8 - random() * height * .2
  }
}

function createGlassDroplet(
  width: number,
  height: number,
  random: () => number,
  distributeCycle: boolean
): GlassDroplet {
  const holdDuration = 2.4 + random() * 7.6
  const slideDuration = 1.4 + random() * 1.8

  return {
    age: distributeCycle ? random() * holdDuration : 0,
    baseY: random() * height * .9,
    holdDuration,
    opacity: .12 + random() * .22,
    radius: .7 + random() * 1.35,
    slideDistance: 18 + random() * height * .22,
    slideDuration,
    slides: random() < .28,
    x: random() * width
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

function getAreaBasedCount(
  width: number,
  height: number,
  areaPerItem: number,
  density: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(
    maximum,
    Math.max(minimum, Math.round(width * height / areaPerItem * density))
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
    let glassDroplets: GlassDroplet[] = []
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

    function resetGlassDroplet(droplet: GlassDroplet): void {
      const nextDroplet = createGlassDroplet(
        width,
        height,
        random,
        false
      )

      Object.assign(droplet, nextDroplet)
    }

    function drawGlassDroplets(deltaSeconds: number): void {
      for (const droplet of glassDroplets) {
        droplet.age += deltaSeconds
        const rawSlideProgress = droplet.slides
          ? (droplet.age - droplet.holdDuration) / droplet.slideDuration
          : 0
        const slideProgress = clampOpacity(rawSlideProgress)

        if (rawSlideProgress >= 1) {
          resetGlassDroplet(droplet)
          continue
        }

        const easedSlideProgress = slideProgress * slideProgress
        const y = droplet.baseY + droplet.slideDistance * easedSlideProgress
        const exitOpacity = 1 - clampOpacity((slideProgress - .68) / .32)
        const opacity = droplet.opacity * exitOpacity

        if (slideProgress > 0) {
          const trailLength = Math.min(
            18,
            droplet.slideDistance * easedSlideProgress
          )

          renderingContext.beginPath()
          renderingContext.lineCap = 'round'
          renderingContext.lineWidth = Math.max(.45, droplet.radius * .42)
          renderingContext.strokeStyle =
            `rgba(191, 211, 229, ${opacity * .42})`
          renderingContext.moveTo(droplet.x, y - droplet.radius)
          renderingContext.lineTo(droplet.x, y - trailLength)
          renderingContext.stroke()
        }

        renderingContext.beginPath()
        renderingContext.fillStyle = `rgba(118, 148, 174, ${opacity * .2})`
        renderingContext.strokeStyle = `rgba(223, 235, 245, ${opacity})`
        renderingContext.lineWidth = .55
        renderingContext.ellipse(
          droplet.x,
          y,
          droplet.radius * .72,
          droplet.radius * 1.18,
          0,
          0,
          Math.PI * 2
        )
        renderingContext.fill()
        renderingContext.stroke()
      }
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

          const entryOpacity = clampOpacity(
            (particle.y + particle.length) / ENTRY_FADE_DISTANCE_PX
          )
          const horizontalExitOpacity = clampOpacity(
            (particle.x + 24) / ENTRY_FADE_DISTANCE_PX
          )
          const opacity = particle.opacity * spawnOpacity * entryOpacity *
            horizontalExitOpacity

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

        const snowDrift = Math.sin(timeSeconds * .72 + particle.phase) * 6

        particle.x += (particle.drift + snowDrift) * deltaSeconds
        particle.y += particle.speed * deltaSeconds

        if (
          particle.y - particle.size > height ||
          particle.x < -8 ||
          particle.x > width + 8
        ) {
          resetParticle(particle)
        }

        const verticalEntryOpacity = clampOpacity(
          (particle.y + particle.size) / ENTRY_FADE_DISTANCE_PX
        )
        const horizontalExitOpacity = Math.min(
          clampOpacity((particle.x + 8) / ENTRY_FADE_DISTANCE_PX),
          clampOpacity((width + 8 - particle.x) / ENTRY_FADE_DISTANCE_PX)
        )
        const opacity = particle.opacity * spawnOpacity *
          verticalEntryOpacity * horizontalExitOpacity

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

      // Precipitation remains behind droplets attached to the glass.
      if (activeAnimation.kind === 'rain') {
        drawGlassDroplets(deltaSeconds)
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
      glassDroplets = activeAnimation.kind === 'rain'
        ? Array.from(
            {
              length: getAreaBasedCount(
                width,
                height,
                GLASS_DROPLET_AREA_PX,
                activeAnimation.glassDensity,
                GLASS_DROPLET_COUNT_MINIMUM,
                GLASS_DROPLET_COUNT_MAXIMUM
              )
            },
            () => createGlassDroplet(width, height, random, true)
          )
        : []
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
