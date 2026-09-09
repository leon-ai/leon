import { createHash } from 'node:crypto'

import {
  COMPUTER_USE_ACTION_SEQUENCE_NAME,
  COMPUTER_USE_PROVIDER_ID,
  COMPUTER_USE_CAPTURE_ACTIONS
} from '@/core/computer-use/constants'
import { asRecord, isComputerUseEffectUncertain, parseJsonRecord } from '@/core/computer-use/utils'

import {
  AGENT_COMPUTER_USE_RECENT_ACTION_LIMIT,
  AGENT_COMPUTER_USE_POINT_PROXIMITY_PX,
  AGENT_COMPUTER_USE_UNVERIFIED_ACTION_THRESHOLD,
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
  failureCode?: string
  focusRecovered: boolean
  inputKey: string
  targetKey: string
  visualStateId?: string
  x?: number
  y?: number
}

const BROWSER_USE_FUNCTION_PREFIX = 'browser_use.playwright.'
const BROWSER_CLI_FUNCTION_PREFIX = 'browser_use.cli.'
const TARGET_AND_CAPTURE_FIELDS = new Set([
  'target', 'pid', 'window_id', 'display_id', 'scope', 'x', 'y', 'capture_after', 'tab_id'
])
const COMPUTER_USE_RETRY_ACTIONS = new Set(
  [...COMPUTER_USE_CAPTURE_ACTIONS, 'browser_act', 'browser_navigate', 'browser_evaluate']
    .filter((action) => action !== 'move_cursor')
)

function isInterfaceExecution(functionName: string): boolean {
  return functionName.startsWith(`${COMPUTER_USE_PROVIDER_ID}.`) ||
    functionName.startsWith(BROWSER_USE_FUNCTION_PREFIX) ||
    functionName.startsWith(BROWSER_CLI_FUNCTION_PREFIX)
}

/** Normalize CLI outcomes into the same browser action contract used by the guard. */
function cliActionInput(input: Record<string, unknown>): Record<string, unknown> {
  const target = asRecord(input['target']) ?? { selector: input['target'] }
  return {
    tab_id: input['tab_id'], action: input['action'],
    ref: JSON.stringify(['selector', 'text', 'tag', 'label', 'context'].map((key) => target[key] ?? '')),
    ...(input['action'] === 'fill' ? {
      value_hash: input['value_hash'] ?? createHash('sha256').update(String(input['value'] ?? '')).digest('hex')
    } : {})
  }
}

/** Includes mechanical batch actions without inventing intermediate captures. */
function parseComputerUseExecutions(
  execution: ExecutionRecord,
  proposed = false
): ParsedComputerUseExecution[] {
  if (execution.function.startsWith(BROWSER_CLI_FUNCTION_PREFIX)) {
    const input = parseJsonRecord(execution.requestedToolInput)
    if (proposed && execution.function.endsWith('.act') && input) {
      return parseComputerUseExecutions({ ...execution, function: `${BROWSER_USE_FUNCTION_PREFIX}act`,
        requestedToolInput: JSON.stringify(cliActionInput(input)) })
    }
    const output = parseJsonRecord(execution.observation)
    const actions = findNestedRecord(output, (record) => Array.isArray(record['browser_actions']))?.['browser_actions']
    if (Array.isArray(actions)) {
      return actions.flatMap((value) => {
        const action = asRecord(value)
        if (!action) return []
        return parseComputerUseExecutions({
          ...execution, function: `${BROWSER_USE_FUNCTION_PREFIX}act`,
          status: action['success'] === true ? 'success' : 'error',
          requestedToolInput: JSON.stringify(cliActionInput(action)),
          observation: JSON.stringify({ ...action,
            ...(action['state_id'] ? { post_action_state: { state_id: action['state_id'] } } : {}) })
        })
      })
    }
    if (execution.function.endsWith('.inspect')) {
      return parseComputerUseExecutions({ ...execution, function: `${BROWSER_USE_FUNCTION_PREFIX}inspect` })
    }
    return []
  }
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
    const result = Array.isArray(results) ? asRecord(results[index]) : null
    // A stopped batch did not execute the remaining requested steps.
    if (!proposed && typeof result?.['success'] !== 'boolean') return []
    const action = parseComputerUseExecution({
      ...execution,
      status: proposed || result?.['success'] === true ? 'success' : 'error',
      function: `${COMPUTER_USE_PROVIDER_ID}.cua.${step['action']}`,
      requestedToolInput: JSON.stringify(parameters),
      observation: JSON.stringify(result ?? {})
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
    !isInterfaceExecution(execution.function) ||
    !execution.requestedToolInput
  ) {
    return null
  }

  try {
    const input = JSON.parse(execution.requestedToolInput) as Record<
      string,
      unknown
    >
    const browserUse = execution.function.startsWith(BROWSER_USE_FUNCTION_PREFIX)
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
    // Post-action evidence takes precedence over input or intermediate metadata.
    const postActionState = findNestedRecord(observation, (record) =>
      asRecord(record['post_action_state']) !== null
    )?.['post_action_state']
    const captureTarget = asRecord(asRecord(postActionState)?.['capture_target'])
    // A desktop fallback cannot establish that the original window is unchanged.
    const captureMatchesTarget = !captureTarget || (
      captureTarget['kind'] === 'desktop'
        ? desktop && (captureTarget['display_id'] ?? 'primary') === displayId
        : captureTarget['pid'] === pid && captureTarget['window_id'] === windowId
    )
    const visualStateId = captureMatchesTarget &&
      (execution.status === 'success' || postActionState)
      ? findNestedString(postActionState ?? observation, browserUse ? 'state_id' : 'visual_state_id')
      : undefined
    const failureCode = execution.status !== 'success'
      ? findNestedString(observation, 'error_code') || findNestedString(observation, 'code')
      : undefined

    return {
      action: `${browserUse ? 'browser_' : ''}${execution.function.split('.').at(-1) || ''}`,
      focusRecovered: execution.status === 'success' && execution.function.endsWith('.bring_to_front'),
      backgroundUnavailable: hasNestedRecord(
        observation,
        (record) => record['code'] === 'background_unavailable' ||
          record['error_code'] === 'background_unavailable'
      ),
      effectUnverifiable: hasNestedRecord(
        observation,
        (record) => isComputerUseEffectUncertain(record['effect'])
      ),
      frameOnlyAccessibility: hasNestedRecord(observation, (record) => {
        const elements = record['elements']
        return record['total_element_count'] === 1 &&
          Array.isArray(elements) &&
          elements.length === 1 &&
          elements[0]?.['role'] === 'frame'
      }),
      targetKey: browserUse ? `browser:${String(input['tab_id'] ?? '')}` : `${String(pid)}:${String(windowId)}:${String(displayId)}`,
      inputKey: JSON.stringify(Object.entries(input)
        .filter(([key]) => !TARGET_AND_CAPTURE_FIELDS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))),
      ...(visualStateId ? { visualStateId } : {}),
      ...(failureCode ? { failureCode } : {}),
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

/** Shares action equivalence between the advisory and the enforced retry guard. */
function isEquivalentAction(
  previous: ParsedComputerUseExecution,
  candidate: ParsedComputerUseExecution
): boolean {
  if (previous.targetKey !== candidate.targetKey ||
      previous.action !== candidate.action || previous.inputKey !== candidate.inputKey) return false
  if (candidate.x === undefined || candidate.y === undefined) {
    return previous.x === candidate.x && previous.y === candidate.y
  }
  return previous.x !== undefined && previous.y !== undefined &&
    Math.abs(previous.x - candidate.x) <= AGENT_COMPUTER_USE_POINT_PROXIMITY_PX &&
    Math.abs(previous.y - candidate.y) <= AGENT_COMPUTER_USE_POINT_PROXIMITY_PX
}

/** An unchanged refresh is evidence of the same state, not permission to retry. */
function getUnchangedStateExecutions(
  executions: ParsedComputerUseExecution[],
  targetKey: string
): ParsedComputerUseExecution[] {
  const streak: ParsedComputerUseExecution[] = []
  let visualStateId: string | undefined
  for (const previous of [...executions].reverse()) {
    if (previous.targetKey !== targetKey) continue
    if (previous.focusRecovered) break
    if (!previous.visualStateId) {
      // Unobserved input may have changed the interface; do not infer a no-op.
      if (COMPUTER_USE_RETRY_ACTIONS.has(previous.action)) break
      continue
    }
    visualStateId ??= previous.visualStateId
    if (previous.visualStateId !== visualStateId) break
    if (COMPUTER_USE_RETRY_ACTIONS.has(previous.action) && !previous.effectUnverifiable) break
    streak.push(previous)
  }
  return streak
}

/** Detects visual interaction loops that should converge before the hard limit. */
export function buildComputerUseConvergenceHint(
  executionHistory: ExecutionRecord[]
): string | null {
  if (!isInterfaceExecution(executionHistory.at(-1)?.function || '')) return null
  const executions = executionHistory
    .flatMap((execution) => parseComputerUseExecutions(execution))
  const current = executions.at(-1)
  if (!current) {
    return null
  }

  const matchingTargetExecutions = executions.slice(-AGENT_COMPUTER_USE_RECENT_ACTION_LIMIT).filter(
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
  // This is advisory only: native Wayland delivery often cannot verify an
  // effect. It catches changing guesses without declaring them failed input.
  const unverifiedActions = current.effectUnverifiable
    ? matchingTargetExecutions.filter((execution) => execution.effectUnverifiable &&
        COMPUTER_USE_RETRY_ACTIONS.has(execution.action)).length
    : 0
  const backgroundUnavailable = matchingTargetExecutions.some(
    (execution) => execution.backgroundUnavailable
  )
  const frameOnlyAccessibilityCount = matchingTargetExecutions.filter(
    (execution) => execution.frameOnlyAccessibility
  ).length
  const repeatedVisualStateCount = current.visualStateId &&
    current.effectUnverifiable
    ? getUnchangedStateExecutions(executions, current.targetKey).filter(
        (execution) =>
          execution.effectUnverifiable &&
          execution.visualStateId === current.visualStateId
      ).length
    : 0
  const reasons = [
    ...(scrollReversals >= AGENT_COMPUTER_USE_SCROLL_REVERSAL_THRESHOLD
      ? ['the same target has been scrolled back and forth repeatedly']
      : []),
    ...(unverifiedActions >= AGENT_COMPUTER_USE_UNVERIFIED_ACTION_THRESHOLD
      ? ['several recent inputs lack driver verification; their intended effects need checking in the observed state']
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
Visual interaction may be looping because ${reasons.join(' and ')}. Inspect existing evidence and the tool's recovery diagnostics before another action. An unchanged refresh does not reset an ineffective-action streak. Prefer an available dedicated tool or documented application API/CLI when it can perform and verify the requested operation. For read-only inspection, answer once the needed facts are available. For edits, verify the intended effect before continuing. Ask the owner only for genuinely missing information or authorization, not routine internal recovery.
</computer_use_convergence>`
}

/** Blocks equivalent input after repeated refusals or unchanged uncertain results. */
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
  }, true).filter((action) => COMPUTER_USE_RETRY_ACTIONS.has(action.action))
  if (candidates.length === 0) return null

  const history = executionHistory
    .flatMap((execution) => parseComputerUseExecutions(execution))
  for (const candidate of candidates) {
    let failedAttempts = 0
    let failureCode: string | undefined
    let latestVisualStateId: string | undefined
    for (const previous of [...history].reverse()) {
      if (previous.targetKey !== candidate.targetKey) continue
      // Refocusing can resolve a delivery refusal without changing pixels.
      if (previous.focusRecovered) break
      if (previous.visualStateId) {
        latestVisualStateId ??= previous.visualStateId
        if (latestVisualStateId !== previous.visualStateId) break
      }
      if (!COMPUTER_USE_RETRY_ACTIONS.has(previous.action)) continue
      // A different input is a recovery attempt. A repeated structured refusal
      // needs a new route or evidence, even when the driver supplies no image.
      if (!previous.failureCode || !isEquivalentAction(previous, candidate)) break
      failureCode ??= previous.failureCode
      if (previous.failureCode !== failureCode) break
      failedAttempts += 1
    }
    if (failedAttempts >= AGENT_COMPUTER_USE_REPEATED_VISUAL_STATE_THRESHOLD) {
      return `Computer-use retry blocked: equivalent input repeatedly failed with ${failureCode}. Inspect the failure diagnostics and current target, then resolve the cause or use a different grounded control or input route. Do not replay the same failed input. This is not a request for renewed user permission.`
    }
    const repeats = getUnchangedStateExecutions(history, candidate.targetKey)
      .filter((previous) => previous.effectUnverifiable &&
        isEquivalentAction(previous, candidate)).length
    if (repeats >= AGENT_COMPUTER_USE_REPEATED_VISUAL_STATE_THRESHOLD) {
      return 'Computer-use retry blocked: equivalent input repeatedly produced the same unverified visual state. Inspect the existing capture and recovery diagnostics, then use a different grounded control or input route. Another unchanged screenshot does not justify replaying this action. This is not a request for renewed user permission.'
    }
  }
  return null
}
