import { clsx } from 'clsx'
import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties
} from 'react'

import { WeatherLayer } from './weather-layer'
import {
  normalizeVibeEnvironment,
  resolveVibeScene,
  type VibeEnvironmentInput
} from './vibes-resolver'
import { type VibeLocationInput } from './vibes-landscapes'
import {
  VIBE_SCENES,
  VIBE_SOLAR_PHASES,
  resolveVibeSceneAsset,
  type VibeEnvironment,
  type VibeScene,
  type VibeSceneId
} from './vibes-scenes'

import { useTheme } from '@/hooks/use-theme'
import type { Theme } from '@/theme'
import { loadImage } from '@/utils/load-image'

import './vibes.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const VIBE_PRELOAD_IDLE_TIMEOUT_MS = 2_000
const CONSTRAINED_CONNECTION_TYPES = new Set(['slow-2g', '2g'])
const preloadedVibeSources = new Set<string>()

interface NavigatorConnection {
  effectiveType?: string
  saveData?: boolean
}

interface IdleCallbackWindow {
  cancelIdleCallback?: (handle: number) => void
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number
}

interface VibesProps {
  environment?: VibeEnvironmentInput
  location?: VibeLocationInput
  sceneId?: VibeSceneId
}

interface VibesStyle extends CSSProperties {
  '--vibes-dark-brightness': number
  '--vibes-dark-contrast': number
  '--vibes-dark-mask-opacity': number
  '--vibes-dark-opacity': number
  '--vibes-dark-saturation': number
  '--vibes-light-brightness': number
  '--vibes-light-contrast': number
  '--vibes-light-mask-opacity': number
  '--vibes-light-opacity': number
  '--vibes-light-saturation': number
  '--vibes-window-height': string
  '--vibes-window-landscape-clip-path': string
  '--vibes-window-right': string
  '--vibes-window-top': string
  '--vibes-window-weather-clip-path': string
  '--vibes-window-width': string
}

interface RenderedVibe {
  assetSrc: string
  environment: VibeEnvironment
  scene: VibeScene
  sceneId: VibeSceneId
  theme: Theme
}

interface VibeTransition {
  outgoingVibe: RenderedVibe
}

function getRenderedVibe(
  environment: VibeEnvironmentInput | undefined,
  location: VibeLocationInput | undefined,
  sceneId: VibeSceneId | undefined,
  theme: Theme
): RenderedVibe {
  const resolution = sceneId === undefined
    ? resolveVibeScene(environment, location)
    : {
        scene: VIBE_SCENES[sceneId],
        sceneId
      }

  return {
    assetSrc: resolveVibeSceneAsset(resolution.scene, theme),
    environment: environment === undefined
      ? resolution.scene.environment
      : normalizeVibeEnvironment(environment),
    scene: resolution.scene,
    sceneId: resolution.sceneId,
    theme
  }
}

function getRenderedVibeKey(renderedVibe: RenderedVibe): string {
  // Reuse the weather canvas when only the theme's palette and artwork change.
  return renderedVibe.sceneId
}

function getNextSolarPhase(
  solarPhase: VibeEnvironment['solarPhase']
): VibeEnvironment['solarPhase'] {
  const currentIndex = VIBE_SOLAR_PHASES.indexOf(solarPhase)
  const nextIndex = (currentIndex + 1) % VIBE_SOLAR_PHASES.length

  return VIBE_SOLAR_PHASES[nextIndex] ?? VIBE_SOLAR_PHASES[0]
}

function shouldPreloadVibeSources(): boolean {
  const connection = (navigator as Navigator & {
    connection?: NavigatorConnection
  }).connection

  return connection?.saveData !== true &&
    !CONSTRAINED_CONNECTION_TYPES.has(connection?.effectiveType ?? '')
}

function preloadVibeSource(src: string): void {
  if (preloadedVibeSources.has(src)) {
    return
  }

  void loadImage(src, 'low').then(() => {
    preloadedVibeSources.add(src)
  }, () => {
    // A failed speculative preload can be retried when its scene is requested.
  })
}

function scheduleVibePreload(callback: () => void): () => void {
  const idleWindow = window as IdleCallbackWindow

  if (
    idleWindow.requestIdleCallback !== undefined &&
    idleWindow.cancelIdleCallback !== undefined
  ) {
    const callbackId = idleWindow.requestIdleCallback(callback, {
      timeout: VIBE_PRELOAD_IDLE_TIMEOUT_MS
    })

    return (): void => idleWindow.cancelIdleCallback?.(callbackId)
  }

  const timeoutId = window.setTimeout(callback, VIBE_PRELOAD_IDLE_TIMEOUT_MS)

  return (): void => window.clearTimeout(timeoutId)
}

function getVibeStyle(scene: VibeScene): VibesStyle {
  return {
    '--vibes-dark-brightness': scene.presentation.dark.brightness,
    '--vibes-dark-contrast': scene.presentation.dark.contrast,
    '--vibes-dark-mask-opacity': scene.presentation.dark.maskOpacity,
    '--vibes-dark-opacity': scene.presentation.dark.opacity,
    '--vibes-dark-saturation': scene.presentation.dark.saturation,
    '--vibes-light-brightness': scene.presentation.light.brightness,
    '--vibes-light-contrast': scene.presentation.light.contrast,
    '--vibes-light-mask-opacity': scene.presentation.light.maskOpacity,
    '--vibes-light-opacity': scene.presentation.light.opacity,
    '--vibes-light-saturation': scene.presentation.light.saturation,
    '--vibes-window-height': scene.window.height,
    '--vibes-window-landscape-clip-path': scene.window.landscapeClipPath,
    '--vibes-window-right': scene.window.right,
    '--vibes-window-top': scene.window.top,
    '--vibes-window-weather-clip-path': scene.window.weatherClipPath,
    '--vibes-window-width': scene.window.width
  }
}

function VibeFrame({
  onExitComplete,
  renderedVibe,
  state
}: {
  onExitComplete?: () => void
  renderedVibe: RenderedVibe
  state: 'active' | 'entering' | 'outgoing'
}) {
  const { environment, scene, sceneId } = renderedVibe

  // CSS owns the duration so visual tuning does not require a matching timer.
  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>): void {
    if (
      state === 'outgoing' &&
      event.target === event.currentTarget
    ) {
      onExitComplete?.()
    }
  }

  return (
    <div
      className={clsx(
        'vibes-frame',
        `vibes-frame-${state}`,
        `vibes-weather-${environment.weather}`,
        `vibes-solar-${environment.solarPhase}`
      )}
      data-landscape={scene.landscape.id}
      data-landscape-country={scene.landscape.location.countryCode}
      data-landscape-locality={scene.landscape.location.locality}
      data-season={environment.season}
      data-vibe-theme={renderedVibe.theme}
      data-vibe-scene={sceneId}
      onAnimationEnd={handleAnimationEnd}
      style={getVibeStyle(scene)}
    >
      <div className="vibes-stage">
        <img
          className="vibes-scene"
          src={renderedVibe.assetSrc}
          alt=""
          decoding="async"
          draggable="false"
        />
        <div className="vibes-weather-window">
          <WeatherLayer weather={environment.weather} />
        </div>
      </div>
      <div className="vibes-tone" />
    </div>
  )
}

/**
 * Displays ambient scenes after their assets load, with optional crossfades.
 */
export function Vibes({
  environment,
  location,
  sceneId
}: VibesProps) {
  const theme = useTheme()
  const requestedVibe = getRenderedVibe(
    environment,
    location,
    sceneId,
    theme
  )
  const [activeVibe, setActiveVibe] = useState(requestedVibe)
  const [transition, setTransition] = useState<VibeTransition | null>(null)
  const activeVibeRef = useRef(activeVibe)
  const requestedVibeRef = useRef(requestedVibe)

  requestedVibeRef.current = requestedVibe

  useEffect(() => {
    const nextVibe = requestedVibeRef.current

    if (nextVibe.assetSrc === activeVibeRef.current.assetSrc) {
      if (nextVibe.theme !== activeVibeRef.current.theme) {
        activeVibeRef.current = nextVibe
        setActiveVibe(nextVibe)
      }

      return
    }

    let isCancelled = false

    const activateScene = () => {
      if (isCancelled) {
        return
      }

      const previousVibe = activeVibeRef.current
      const shouldAnimate = nextVibe.theme === previousVibe.theme &&
        !window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches

      activeVibeRef.current = nextVibe
      setTransition(shouldAnimate
        ? {
            outgoingVibe: previousVibe
          }
        : null)
      setActiveVibe(nextVibe)
    }

    void loadImage(nextVibe.assetSrc, 'high').then(activateScene, () => {
      // Keep the current complete scene if the replacement cannot be decoded.
    })

    return () => {
      isCancelled = true
    }
  }, [requestedVibe.assetSrc])

  useEffect(() => {
    if (!shouldPreloadVibeSources()) {
      return
    }

    return scheduleVibePreload(() => {
      const oppositeTheme: Theme = activeVibe.theme === 'dark'
        ? 'light'
        : 'dark'
      const nextSolarPhase = getNextSolarPhase(
        activeVibe.environment.solarPhase
      )
      const nextResolution = resolveVibeScene({
        ...activeVibe.environment,
        solarPhase: nextSolarPhase
      }, location)
      const candidateSources = new Set([
        resolveVibeSceneAsset(activeVibe.scene, oppositeTheme),
        resolveVibeSceneAsset(nextResolution.scene, activeVibe.theme),
        resolveVibeSceneAsset(nextResolution.scene, oppositeTheme)
      ])

      candidateSources.delete(activeVibe.assetSrc)
      candidateSources.forEach(preloadVibeSource)
    })
  }, [activeVibe, location])

  return (
    <div className="vibes" aria-hidden="true">
      {transition !== null && (
        <VibeFrame
          key={getRenderedVibeKey(transition.outgoingVibe)}
          onExitComplete={() => {
            setTransition((currentTransition) => (
              currentTransition !== null &&
              getRenderedVibeKey(currentTransition.outgoingVibe) ===
                getRenderedVibeKey(transition.outgoingVibe)
                ? null
                : currentTransition
            ))
          }}
          renderedVibe={transition.outgoingVibe}
          state="outgoing"
        />
      )}
      <VibeFrame
        key={getRenderedVibeKey(activeVibe)}
        renderedVibe={activeVibe}
        state={transition === null ? 'active' : 'entering'}
      />
    </div>
  )
}
