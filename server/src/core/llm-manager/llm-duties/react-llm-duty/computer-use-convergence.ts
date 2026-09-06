import { COMPUTER_USE_PROVIDER_ID } from '@/core/computer-use/constants'

import {
  AGENT_COMPUTER_USE_CONVERGENCE_CALL_THRESHOLD,
  AGENT_COMPUTER_USE_POINT_PROXIMITY_PX,
  AGENT_COMPUTER_USE_REPEATED_POINT_THRESHOLD,
  AGENT_COMPUTER_USE_SCROLL_REVERSAL_THRESHOLD
} from './constants'
import type { ExecutionRecord } from './types'

interface ParsedComputerUseExecution {
  action: string
  backgroundUnavailable: boolean
  direction?: string
  frameOnlyAccessibility: boolean
  targetKey: string
  x?: number
  y?: number
}

function hasNestedRecord(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasNestedRecord(item, predicate))
  }
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return predicate(record) ||
    Object.values(record).some((item) => hasNestedRecord(item, predicate))
}

function parseComputerUseExecution(
  execution: ExecutionRecord
): ParsedComputerUseExecution | null {
  if (
    !execution.function.startsWith(`${COMPUTER_USE_PROVIDER_ID}.`) ||
    !execution.requestedToolInput
  ) {
    return null
  }

  try {
    const input = JSON.parse(execution.requestedToolInput) as Record<
      string,
      unknown
    >
    const target = input['target']
    const targetRecord =
      target && typeof target === 'object' && !Array.isArray(target)
        ? target as Record<string, unknown>
        : null
    const pid = targetRecord?.['pid'] ?? input['pid'] ?? ''
    const windowId = targetRecord?.['window_id'] ?? input['window_id'] ?? ''
    const displayId = targetRecord?.['display_id'] ?? input['display_id'] ?? ''
    let observation: unknown = null
    try {
      observation = JSON.parse(execution.observation) as unknown
    } catch {
      // Plain-text observations have no structured capability diagnostics.
    }

    return {
      action: execution.function.split('.').at(-1) || '',
      backgroundUnavailable: hasNestedRecord(
        observation,
        (record) => record['code'] === 'background_unavailable'
      ),
      frameOnlyAccessibility: hasNestedRecord(observation, (record) => {
        const elements = record['elements']
        return record['total_element_count'] === 1 &&
          Array.isArray(elements) &&
          elements.length === 1 &&
          elements[0]?.['role'] === 'frame'
      }),
      targetKey: `${String(pid)}:${String(windowId)}:${String(displayId)}`,
      ...(typeof input['direction'] === 'string'
        ? { direction: input['direction'] }
        : {}),
      ...(typeof input['x'] === 'number' ? { x: input['x'] } : {}),
      ...(typeof input['y'] === 'number' ? { y: input['y'] } : {})
    }
  } catch {
    return null
  }
}

/** Detects visual interaction loops that should converge before the hard limit. */
export function buildComputerUseConvergenceHint(
  executionHistory: ExecutionRecord[]
): string | null {
  const executions = executionHistory
    .map(parseComputerUseExecution)
    .filter((execution): execution is ParsedComputerUseExecution => Boolean(execution))
  const current = executions.at(-1)
  if (!current) {
    return null
  }

  const matchingTargetExecutions = executions.filter(
    (execution) => execution.targetKey === current.targetKey
  )
  const scrollDirections = matchingTargetExecutions
    .filter((execution) => execution.action === 'scroll' && execution.direction)
    .map((execution) => execution.direction!)
  const scrollReversals = scrollDirections.reduce(
    (count, direction, index) =>
      index > 0 && direction !== scrollDirections[index - 1]
        ? count + 1
        : count,
    0
  )
  const nearbyPointActions =
    current.x === undefined || current.y === undefined
      ? 0
      : matchingTargetExecutions.filter(
          (execution) =>
            execution.action === current.action &&
            execution.x !== undefined &&
            execution.y !== undefined &&
            Math.abs(execution.x - current.x!) <=
              AGENT_COMPUTER_USE_POINT_PROXIMITY_PX &&
            Math.abs(execution.y - current.y!) <=
              AGENT_COMPUTER_USE_POINT_PROXIMITY_PX
        ).length
  const backgroundUnavailable = matchingTargetExecutions.some(
    (execution) => execution.backgroundUnavailable
  )
  const frameOnlyAccessibilityCount = matchingTargetExecutions.filter(
    (execution) => execution.frameOnlyAccessibility
  ).length
  const reasons = [
    ...(executions.length >= AGENT_COMPUTER_USE_CONVERGENCE_CALL_THRESHOLD
      ? [`${executions.length} computer-use calls have already run`]
      : []),
    ...(scrollReversals >= AGENT_COMPUTER_USE_SCROLL_REVERSAL_THRESHOLD
      ? ['the same target has been scrolled back and forth repeatedly']
      : []),
    ...(nearbyPointActions >= AGENT_COMPUTER_USE_REPEATED_POINT_THRESHOLD
      ? ['nearly the same screen point has been used repeatedly']
      : []),
    ...(backgroundUnavailable
      ? ['background delivery is unavailable for this target']
      : []),
    ...(frameOnlyAccessibilityCount >= 2
      ? ['repeated accessibility snapshots exposed only the outer application frame']
      : [])
  ]
  if (reasons.length === 0) {
    return null
  }

  return `<computer_use_convergence>
Visual interaction may be looping because ${reasons.join(' and ')}. Reuse the screenshots and observations already collected. If this is a read-only inspection, answer now unless one specifically named missing fact requires one decisive action. Otherwise choose one forward action and do not revisit an inspected state.
</computer_use_convergence>`
}
