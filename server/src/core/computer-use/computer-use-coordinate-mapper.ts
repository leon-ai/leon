import { COMPUTER_USE_MODEL_IMAGE_PIXEL_BUDGET } from './constants'
import type {
  ComputerUseImageDimensions,
  ComputerUseImageTransform
} from './types'

/** Returns whether local Cua must avoid ephemeral MPX/uinput devices. */
export function shouldUseCuaSafeX11Input(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): boolean {
  if (platform !== 'linux') {
    return false
  }

  const sessionType = environment['XDG_SESSION_TYPE']?.trim().toLowerCase()
  if (sessionType === 'wayland') {
    return false
  }
  if (sessionType === 'x11') {
    return true
  }

  return Boolean(
    environment['DISPLAY']?.trim() && !environment['WAYLAND_DISPLAY']?.trim()
  )
}

/** Fits captures to a model-friendly pixel area without assuming a display. */
export function calculateComputerUseModelImageDimensions(
  source: ComputerUseImageDimensions,
  pixelBudget = COMPUTER_USE_MODEL_IMAGE_PIXEL_BUDGET
): ComputerUseImageDimensions {
  const sourcePixels = source.width * source.height
  if (sourcePixels <= pixelBudget) {
    return source
  }

  const scale = Math.sqrt(pixelBudget / sourcePixels)
  return {
    width: Math.max(Math.round(source.width * scale), 1),
    height: Math.max(Math.round(source.height * scale), 1)
  }
}

/** Maps one point from Leon's attached model image to the source capture. */
export function mapComputerUsePointToSource(
  point: { x: number, y: number },
  transform: ComputerUseImageTransform
): { x: number, y: number } {
  return {
    x: mapComputerUseCoordinateToSource(point.x, 'x', transform),
    y: mapComputerUseCoordinateToSource(point.y, 'y', transform)
  }
}

/** Maps one coordinate axis from a model image to the source capture. */
export function mapComputerUseCoordinateToSource(
  value: number,
  axis: 'x' | 'y',
  transform: ComputerUseImageTransform
): number {
  const sourceSize = transform.source[axis === 'x' ? 'width' : 'height']
  const modelSize = transform.model[axis === 'x' ? 'width' : 'height']

  return Math.min(
    Math.max(
      Math.round((value * (sourceSize - 1)) / Math.max(modelSize - 1, 1)),
      0
    ),
    sourceSize - 1
  )
}
