import {
  COMPUTER_USE_SET_OF_MARK_BADGE_HEIGHT,
  COMPUTER_USE_SET_OF_MARK_COLOR,
  COMPUTER_USE_SET_OF_MARK_FONT_SIZE,
  COMPUTER_USE_SET_OF_MARK_LIMIT
} from './constants'
import {
  ComputerUseSetOfMarkMode,
  type ComputerUseImageDimensions,
  type ComputerUseSetOfMarkAnnotation
} from './types'
import { asRecord } from './utils'

interface ComputerUseSetOfMarkCandidate extends ComputerUseSetOfMarkAnnotation {
  frame: { x: number, y: number, width: number, height: number }
  label: string
}

interface ComputerUseSetOfMarkPlan {
  annotations: ComputerUseSetOfMarkAnnotation[]
  filter: string | null
}

function getFiniteNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Builds a stable key shared by raw and compacted accessibility elements. */
export function getComputerUseSetOfMarkKey(
  element: Record<string, unknown>
): string | null {
  const token = element['element_token']
  if (typeof token === 'string' && token.length > 0) {
    return `token:${token}`
  }

  const index = element['element_index']
  return Number.isInteger(index) ? `index:${index}` : null
}

/** Creates model-only visual markers for actionable accessibility elements. */
export function createComputerUseSetOfMarkPlan(
  result: Record<string, unknown> | null,
  mode: ComputerUseSetOfMarkMode,
  modelDimensions: ComputerUseImageDimensions
): ComputerUseSetOfMarkPlan {
  if (mode === ComputerUseSetOfMarkMode.Never || !result) {
    return { annotations: [], filter: null }
  }

  const windowBounds = asRecord(result['window_bounds'])
  const windowX = getFiniteNumber(windowBounds?.['x'])
  const windowY = getFiniteNumber(windowBounds?.['y'])
  const windowWidth = getFiniteNumber(windowBounds?.['width'])
  const windowHeight = getFiniteNumber(windowBounds?.['height'])
  if (
    windowX === null ||
    windowY === null ||
    windowWidth === null ||
    windowHeight === null ||
    windowWidth <= 0 ||
    windowHeight <= 0
  ) {
    return { annotations: [], filter: null }
  }

  const elements = Array.isArray(result['elements']) ? result['elements'] : []
  const candidates = elements.flatMap((value): ComputerUseSetOfMarkCandidate[] => {
    const element = asRecord(value)
    const frame = asRecord(element?.['frame'])
    const key = element && getComputerUseSetOfMarkKey(element)
    const x = getFiniteNumber(frame?.['x'])
    const y = getFiniteNumber(frame?.['y'])
    const width = getFiniteNumber(frame?.['w'] ?? frame?.['width'])
    const height = getFiniteNumber(frame?.['h'] ?? frame?.['height'])
    if (
      !element ||
      !key ||
      !Array.isArray(element['actions']) ||
      element['actions'].length === 0 ||
      x === null ||
      y === null ||
      width === null ||
      height === null ||
      width <= 1 ||
      height <= 1
    ) {
      return []
    }

    return [{
      key,
      mark: 0,
      frame: { x, y, width, height },
      label: String(element['label'] || element['value'] || '')
        .trim()
        .toLocaleLowerCase()
    }]
  })
  const labelCounts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.label) {
      labelCounts.set(candidate.label, (labelCounts.get(candidate.label) || 0) + 1)
    }
  }
  const selected = candidates
    .filter((candidate) =>
      mode === ComputerUseSetOfMarkMode.Always ||
      !candidate.label ||
      (labelCounts.get(candidate.label) || 0) > 1
    )
    .slice(0, COMPUTER_USE_SET_OF_MARK_LIMIT)
    .map((candidate, index) => ({ ...candidate, mark: index + 1 }))
  if (selected.length === 0) {
    return { annotations: [], filter: null }
  }

  const scaleX = modelDimensions.width / windowWidth
  const scaleY = modelDimensions.height / windowHeight
  const filter = selected.flatMap((candidate) => {
    const x = Math.max(0, Math.round((candidate.frame.x - windowX) * scaleX))
    const y = Math.max(0, Math.round((candidate.frame.y - windowY) * scaleY))
    const width = Math.max(2, Math.round(candidate.frame.width * scaleX))
    const height = Math.max(2, Math.round(candidate.frame.height * scaleY))
    const badgeWidth = candidate.mark >= 10
      ? COMPUTER_USE_SET_OF_MARK_BADGE_HEIGHT
      : Math.round(COMPUTER_USE_SET_OF_MARK_BADGE_HEIGHT * 0.7)

    return [
      `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=${COMPUTER_USE_SET_OF_MARK_COLOR}@0.9:t=2`,
      `drawbox=x=${x}:y=${y}:w=${badgeWidth}:h=${COMPUTER_USE_SET_OF_MARK_BADGE_HEIGHT}:color=${COMPUTER_USE_SET_OF_MARK_COLOR}@0.95:t=fill`,
      `drawtext=font=Sans:text='${candidate.mark}':x=${x + 3}:y=${y + 1}:fontsize=${COMPUTER_USE_SET_OF_MARK_FONT_SIZE}:fontcolor=black`
    ]
  }).join(',')

  return {
    annotations: selected.map(({ key, mark }) => ({ key, mark })),
    filter
  }
}
