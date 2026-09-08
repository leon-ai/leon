import {
  COMPUTER_USE_ACTION_SEQUENCE_NAME,
  COMPUTER_USE_PROVIDER_ID
} from '@/core/computer-use/constants'
import { asRecord, parseJsonRecord } from '@/core/computer-use/utils'

import {
  AGENT_COMPUTER_USE_CONVERGENCE_CALL_THRESHOLD,
  AGENT_COMPUTER_USE_POINT_PROXIMITY_PX,
  AGENT_COMPUTER_USE_REPEATED_POINT_THRESHOLD,
  AGENT_COMPUTER_USE_REPEATED_VISUAL_STATE_THRESHOLD,
  AGENT_COMPUTER_USE_SCROLL_REVERSAL_THRESHOLD
} from './constants'
import type { ExecutionRecord } from './types'

interface ParsedComputerUseExecution {
  action: string
  backgroundUnavailable: boolean
  direction?: string
  frameOnlyAccessibility: boolean
  effectUnverifiable: boolean
  targetKey: string
  visualStateId?: string
  x?: number
  y?: number
}

const COMPUTER_USE_OBSERVATION_ACTIONS = new Set([
  'get_window_state',
  'get_desktop_state',
  'get_browser_state'
])

/** Includes mechanical batch actions without inventing intermediate captures. */
function parseComputerUseExecutions(
  execution: ExecutionRecord
): ParsedComputerUseExecution[] {
  const parsed = parseComputerUseExecution(execution)
  if (!parsed) return []
  if (parsed.action !== COMPUTER_USE_ACTION_SEQUENCE_NAME) return [parsed]

  const input = parseJsonRecord(execution.requestedToolInput)
  const steps = input?.['steps']
  if (!Array.isArray(steps)) return []
  const results = findNestedRecord(
    parseJsonRecord(execution.observation),
    (record) => Array.isArray(record['steps'])
  )?.['steps']
  const actions = steps.flatMap((value, index) => {
    const step = asRecord(value)
    const parameters = asRecord(step?.['parameters'])
    if (typeof step?.['action'] !== 'string' || !parameters) return []
    const action = parseComputerUseExecution({
      ...execution,
      function: `${COMPUTER_USE_PROVIDER_ID}.cua.${step['action']}`,
      requestedToolInput: JSON.stringify(parameters),
      observation: JSON.stringify(Array.isArray(results) ? results[index] ?? {} : {})
    })
    return action ? [action] : []
  })
  // A batch capture describes only its final target, not every intermediate
  // state. Repeated clicks can use that outcome only on the same target.
  const finalTarget = actions.at(-1)?.targetKey
  return actions.map((action) =>
    action.targetKey === finalTarget && parsed.visualStateId
      ? { ...action, visualStateId: parsed.visualStateId }
      : action
  )
}

function findNestedRecord(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNestedRecord(item, predicate)
      if (match) return match
    }
    return null
  }
  const record = asRecord(value)
  if (!record) return null
  return predicate(record) ? record : findNestedRecord(Object.values(record), predicate)
}

function hasNestedRecord(
  value: unknown,
  predicate: (record: Record<string, unknown>) => boolean
): boolean {
  return findNestedRecord(value, predicate) !== null
}

function findNestedString(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => findNestedString(item, key)).find(Boolean)
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (typeof record[key] === 'string') {
    return record[key]
  }
  return Object.values(record)
    .map((item) => findNestedString(item, key))
    .find(Boolean)
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
    const desktop = targetRecord?.['kind'] === 'desktop' ||
      input['scope'] === 'desktop' || execution.function.endsWith('.get_desktop_state')
    const displayId = targetRecord?.['display_id'] ?? input['display_id'] ??
      (desktop ? 'primary' : '')
    let observation: unknown = null
    try {
      observation = JSON.parse(execution.observation) as unknown
    } catch {
      // Plain-text observations have no structured capability diagnostics.
    }
    const visualStateId = findNestedString(observation, 'visual_state_id')

    return {
      action: execution.function.split('.').at(-1) || '',
      backgroundUnavailable: hasNestedRecord(
        observation,
        (record) => record['code'] === 'background_unavailable'
      ),
      effectUnverifiable: hasNestedRecord(
        observation,
        (record) => ['unverifiable', 'suspected_noop'].includes(
          String(record['effect'])
        )
      ),
      frameOnlyAccessibility: hasNestedRecord(observation, (record) => {
        const elements = record['elements']
        return record['total_element_count'] === 1 &&
          Array.isArray(elements) &&
          elements.length === 1 &&
          elements[0]?.['role'] === 'frame'
      }),
      targetKey: `${String(pid)}:${String(windowId)}:${String(displayId)}`,
      ...(visualStateId ? { visualStateId } : {}),
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
    .flatMap(parseComputerUseExecutions)
  const callCount = executionHistory.filter((execution) =>
    execution.function.startsWith(`${COMPUTER_USE_PROVIDER_ID}.`)
  ).length
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
  const repeatedVisualStateCount = current.visualStateId &&
    current.effectUnverifiable
    ? matchingTargetExecutions.filter(
        (execution) =>
          execution.effectUnverifiable &&
          execution.visualStateId === current.visualStateId
      ).length
    : 0
  const reasons = [
    ...(callCount >= AGENT_COMPUTER_USE_CONVERGENCE_CALL_THRESHOLD
      ? [`${callCount} computer-use calls have already run`]
      : []),
    ...(scrollReversals >= AGENT_COMPUTER_USE_SCROLL_REVERSAL_THRESHOLD
      ? ['the same target has been scrolled back and forth repeatedly']
      : []),
    ...(nearbyPointActions >= AGENT_COMPUTER_USE_REPEATED_POINT_THRESHOLD
      ? ['nearly the same screen point has been used repeatedly']
      : []),
    ...(repeatedVisualStateCount >=
      AGENT_COMPUTER_USE_REPEATED_VISUAL_STATE_THRESHOLD
      ? ['multiple uncertain actions produced the same visual state']
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
Visual interaction may be looping because ${reasons.join(' and ')}. Reuse existing captures first. For read-only inspection, answer unless one specific missing fact requires a decisive action. For edits, verify the intended effect before continuing; take a fresh observation when recovery requires new grounding, and do not repeat an ineffective action without new evidence. If required information or choices remain unresolved after available tools and the request are considered, call request_clarification; internal recovery alone does not require renewed permission.
</computer_use_convergence>`
}

/** Blocks another equivalent click after repeated unchanged, uncertain results. */
export function getComputerUseRetryBlocker(
  executionHistory: ExecutionRecord[],
  qualifiedName: string,
  requestedToolInput: string
): string | null {
  const candidates = parseComputerUseExecutions({
    function: qualifiedName,
    requestedToolInput,
    status: 'success',
    observation: '{}'
  }).filter((action) => action.action === 'click' &&
    action.x !== undefined && action.y !== undefined)
  if (candidates.length === 0) return null

  const history = executionHistory
    .filter((execution) => execution.status === 'success')
    .flatMap(parseComputerUseExecutions)
    .reverse()
  for (const candidate of candidates) {
    let visualStateId: string | undefined
    let repeats = 0
    for (const previous of history) {
      if (previous.targetKey !== candidate.targetKey) continue
      // A fresh explicit observation permits a newly grounded attempt. Any
      // visible progress also invalidates the previous no-progress streak.
      if (COMPUTER_USE_OBSERVATION_ACTIONS.has(previous.action) && previous.visualStateId) break
      if (!previous.visualStateId) continue
      visualStateId ??= previous.visualStateId
      if (previous.visualStateId !== visualStateId) break
      if (previous.action === 'click' && previous.effectUnverifiable &&
          previous.x !== undefined && previous.y !== undefined &&
          Math.abs(previous.x - candidate.x!) <= AGENT_COMPUTER_USE_POINT_PROXIMITY_PX &&
          Math.abs(previous.y - candidate.y!) <= AGENT_COMPUTER_USE_POINT_PROXIMITY_PX) {
        repeats++
      }
      if (repeats >= AGENT_COMPUTER_USE_REPEATED_VISUAL_STATE_THRESHOLD) {
        return 'Computer-use retry blocked: repeated clicks near this point produced the same unverified visual state. Take a fresh observation of this target and reassess the control before another click, or choose a different grounded approach. This is not a request for renewed user permission.'
      }
    }
  }
  return null
}
