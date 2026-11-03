const COMPUTER_USE_SEQUENCE_TARGET_FIELDS = [
  'target', 'pid', 'window_id', 'display_id', 'scope'
]

export const COMPUTER_USE_FOCUSED_SEQUENCE_NAME = 'act'

/**
 * Cua input names shared by its evidence capture and the agent repetition guard.
 */
export const COMPUTER_USE_CAPTURE_ACTIONS = new Set([
  'copy_text',
  'move_cursor',
  'invoke_menu',
  'click',
  'drag',
  'scroll',
  'type_text',
  'set_value',
  'press_key',
  'hotkey'
])

/**
 * Dispatch success alone does not establish the intended interface effect.
 */
export function isComputerUseEffectUncertain(effect: unknown): boolean {
  return effect === 'unverifiable' || effect === 'suspected_noop'
}

/**
 * Expands an explicit batch target identically for execution and retry checking.
 * A step selecting another target must provide its complete target itself.
 */
export function resolveComputerUseSequenceParameters(
  parameters: Record<string, unknown>,
  target: unknown
): Record<string, unknown> {
  if (target == null || COMPUTER_USE_SEQUENCE_TARGET_FIELDS.some(
    (key) => parameters[key] != null
  )) {
    return parameters
  }

  return { ...parameters, target }
}

/**
 * Includes the single focus click in the same sequence seen by retry checking.
 */
export function expandComputerUseSequenceSteps(
  steps: unknown,
  focus?: unknown
): unknown[] | null {
  if (!Array.isArray(steps)) {
    return null
  }

  return focus == null ? steps : [{ action: 'click', parameters: focus }, ...steps]
}
