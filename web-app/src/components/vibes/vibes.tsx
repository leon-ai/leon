import { clsx } from 'clsx'
import type { CSSProperties } from 'react'

import { WeatherLayer } from './weather-layer'
import {
  normalizeVibeEnvironment,
  resolveVibeScene,
  type VibeEnvironmentInput
} from './vibes-resolver'
import {
  DEFAULT_VIBE_SCENE_ID,
  VIBE_SCENES,
  type VibeInterior,
  type VibeScene,
  type VibeSceneId
} from './vibes-scenes'

import './vibes.sass'

interface VibesProps {
  environment?: VibeEnvironmentInput
  interior?: {
    cupState?: VibeInterior['cupState']
    lamp?: Partial<VibeInterior['lamp']>
  }
  sceneId?: VibeSceneId
}

interface VibesStyle extends CSSProperties {
  '--vibes-dark-brightness': number
  '--vibes-dark-contrast': number
  '--vibes-dark-mask-opacity': number
  '--vibes-dark-opacity': number
  '--vibes-dark-saturation': number
  '--vibes-lamp-intensity': number
  '--vibes-light-brightness': number
  '--vibes-light-contrast': number
  '--vibes-light-mask-opacity': number
  '--vibes-light-opacity': number
  '--vibes-light-saturation': number
}

function renderScene(scene: VibeScene) {
  if (scene.assets.type === 'composite') {
    return (
      <img
        className="vibes-scene"
        src={scene.assets.sceneSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
    )
  }

  return (
    <>
      <img
        className="vibes-scene-layer vibes-room-desk"
        src={scene.assets.roomDeskSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
      <div className="vibes-window-view">
        <img
          className="vibes-scene-layer vibes-landscape"
          src={scene.assets.landscapeSrc}
          alt=""
          decoding="async"
          draggable="false"
        />
      </div>
      <img
        className="vibes-scene-layer vibes-window-frame"
        src={scene.assets.windowFrameSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
      <img
        className="vibes-scene-layer vibes-lamp-plant"
        src={scene.assets.lampPlantSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
      <div className="vibes-lamp-glow" />
      <img
        className="vibes-scene-layer vibes-keyboard"
        src={scene.assets.keyboardSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
      <img
        className="vibes-scene-layer vibes-cup"
        src={scene.assets.cupSrc}
        alt=""
        decoding="async"
        draggable="false"
      />
      <div className="vibes-cup-steam" />
    </>
  )
}

export function Vibes({ environment, interior, sceneId }: VibesProps) {
  const resolution = sceneId === undefined
    ? resolveVibeScene(environment)
    : {
      scene: VIBE_SCENES[sceneId],
      sceneId
    }
  const scene = resolution.scene
  const activeEnvironment = environment === undefined
    ? scene.environment
    : normalizeVibeEnvironment(environment)
  const activeInterior: VibeInterior = {
    ...scene.interior,
    ...interior,
    lamp: {
      ...scene.interior.lamp,
      ...interior?.lamp
    }
  }
  const style: VibesStyle = {
    '--vibes-dark-brightness': scene.presentation.dark.brightness,
    '--vibes-dark-contrast': scene.presentation.dark.contrast,
    '--vibes-dark-mask-opacity': scene.presentation.dark.maskOpacity,
    '--vibes-dark-opacity': scene.presentation.dark.opacity,
    '--vibes-dark-saturation': scene.presentation.dark.saturation,
    '--vibes-lamp-intensity': activeInterior.lamp.isOn
      ? activeInterior.lamp.intensity
      : 0,
    '--vibes-light-brightness': scene.presentation.light.brightness,
    '--vibes-light-contrast': scene.presentation.light.contrast,
    '--vibes-light-mask-opacity': scene.presentation.light.maskOpacity,
    '--vibes-light-opacity': scene.presentation.light.opacity,
    '--vibes-light-saturation': scene.presentation.light.saturation
  }

  return (
    <div
      className={clsx(
        'vibes',
        `vibes-scene-${scene.assets.type}`,
        `vibes-weather-${activeEnvironment.weather}`,
        `vibes-solar-${activeEnvironment.solarPhase}`
      )}
      data-cup-state={activeInterior.cupState}
      data-lamp-on={activeInterior.lamp.isOn}
      data-season={activeEnvironment.season}
      data-vibe-scene={resolution.sceneId ?? DEFAULT_VIBE_SCENE_ID}
      style={style}
      aria-hidden="true"
    >
      <div className="vibes-stage">
        <div className="vibes-scene-art">
          {renderScene(scene)}
        </div>
        <div className="vibes-weather-window">
          <WeatherLayer weather={activeEnvironment.weather} />
        </div>
      </div>
      <div className="vibes-tone" />
    </div>
  )
}
