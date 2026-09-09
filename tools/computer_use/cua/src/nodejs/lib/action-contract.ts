/**
 * Cua input names shared by its evidence capture and the agent repetition guard.
 */
export const COMPUTER_USE_CAPTURE_ACTIONS = new Set([
  'move_cursor',
  'invoke_menu',
  'click',
  'drag',
  'scroll',
  'type_text',
  'press_key',
  'hotkey'
])

/**
 * Dispatch success alone does not establish the intended interface effect.
 */
export function isComputerUseEffectUncertain(effect: unknown): boolean {
  return effect === 'unverifiable' || effect === 'suspected_noop'
}
