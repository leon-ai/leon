import type { ToolContentPart } from '../../../../server/src/core/session-manager/tool-content-contract'
import { getToolResultData } from './tool-content'

const MAXIMUM_CHANGE_CHARACTERS = 65_536

export interface ToolChange {
  path: string
  oldText: string
  newText: string
}

/**
 * Requires an explicit applied-change result rather than guessing from log text.
 */
export function hasToolChanges(value: unknown): boolean {
  const result = getToolResultData(value)

  return result?.['changed'] === true && typeof result['diff'] === 'string'
}

/**
 * Reads actual replacement pairs only when a successful edit result confirms a
 * change. Bounded diff previews are never interpreted as complete source files.
 */
export function getToolChanges(input: ToolContentPart | undefined, hasChanges: boolean): ToolChange[] {
  if (!hasChanges || !input || input.truncated || input.text.length > MAXIMUM_CHANGE_CHARACTERS) {
    return []
  }

  try {
    const value = JSON.parse(input.text) as { path?: unknown, changes?: unknown }
    if (typeof value.path !== 'string' || !Array.isArray(value.changes)) {
      return []
    }

    return value.changes.flatMap((replacement: unknown) => {
      if (!replacement || typeof replacement !== 'object' || !('oldText' in replacement) || !('newText' in replacement) ||
        typeof replacement.oldText !== 'string' || typeof replacement.newText !== 'string') {
        return []
      }

      return [{ path: value.path as string, oldText: replacement.oldText, newText: replacement.newText }]
    })
  } catch {
    return []
  }
}
