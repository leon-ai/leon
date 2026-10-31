const LEADING_RESPONSE_MS = 24
const TRAILING_RESPONSE_MS = 65
const MAXIMUM_FRAME_MS = 32
const SETTLED_DISTANCE_PX = 0.1
const SETTLED_SPEED_PX_PER_MS = 0.005
const CORNER_FACTORS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
] as const

export interface CaretBounds {
  x: number
  y: number
  width: number
  height: number
}

interface CaretCorner {
  x: number
  y: number
  velocityX: number
  velocityY: number
  factorX: number
  factorY: number
}

export interface CaretMotion {
  corners: CaretCorner[]
  directionX: number
  directionY: number
}

/**
 * Starts a caret at rest, with corners ordered around its perimeter.
 */
export function createCaretMotion(bounds: CaretBounds): CaretMotion {
  return {
    directionX: 1,
    directionY: 0,
    corners: CORNER_FACTORS.map((factor) => ({
      x: bounds.x + bounds.width * factor.x,
      y: bounds.y + bounds.height * factor.y,
      velocityX: 0,
      velocityY: 0,
      factorX: factor.x,
      factorY: factor.y
    }))
  }
}

/**
 * Advances damped corner springs. Leading corners respond first, while trailing
 * corners stretch the same solid block until it settles at the native caret.
 */
export function advanceCaretMotion(
  motion: CaretMotion,
  bounds: CaretBounds,
  elapsedMs: number
): boolean {
  const elapsed = Math.max(0, Math.min(MAXIMUM_FRAME_MS, elapsedMs))
  let moving = false

  for (const corner of motion.corners) {
    const targetX = bounds.x + bounds.width * corner.factorX
    const targetY = bounds.y + bounds.height * corner.factorY
    const projectionX = (corner.factorX - 0.5) * bounds.width * motion.directionX
    const projectionY = (corner.factorY - 0.5) * bounds.height * motion.directionY
    const projection = (projectionX + projectionY) /
      (Math.abs(projectionX) + Math.abs(projectionY) || 1)
    const response = (LEADING_RESPONSE_MS + TRAILING_RESPONSE_MS) / 2 -
      projection * (TRAILING_RESPONSE_MS - LEADING_RESPONSE_MS) / 2
    const frequency = 1 / response
    const decay = Math.exp(-elapsed * frequency)
    const displacementX = corner.x - targetX
    const displacementY = corner.y - targetY
    const impulseX = corner.velocityX + frequency * displacementX
    const impulseY = corner.velocityY + frequency * displacementY

    // The analytic critically damped step avoids frame-rate-dependent wobble
    // and unstable integration when typing redirects an in-flight caret.
    corner.x = targetX + (displacementX + impulseX * elapsed) * decay
    corner.y = targetY + (displacementY + impulseY * elapsed) * decay
    corner.velocityX = (corner.velocityX - frequency * impulseX * elapsed) * decay
    corner.velocityY = (corner.velocityY - frequency * impulseY * elapsed) * decay

    if (
      Math.abs(corner.x - targetX) < SETTLED_DISTANCE_PX &&
      Math.abs(corner.y - targetY) < SETTLED_DISTANCE_PX &&
      Math.abs(corner.velocityX) < SETTLED_SPEED_PX_PER_MS &&
      Math.abs(corner.velocityY) < SETTLED_SPEED_PX_PER_MS
    ) {
      corner.x = targetX
      corner.y = targetY
      corner.velocityX = 0
      corner.velocityY = 0
    } else {
      moving = true
    }
  }

  return moving
}
