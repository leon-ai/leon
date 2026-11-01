import type { ToolContentPart } from '../../../../server/src/core/session-manager/tool-content-contract'
import { TOOL_CONTENT_PREVIEW_CHARACTERS } from '../../../../server/src/core/session-manager/tool-content-contract'
import type { JsonValue } from '@/data/feed'

const MAXIMUM_FORMATTED_INPUT_CHARACTERS = 65_536

/**
 * Reads the native tool runtime's result/data envelope without discarding the
 * original response used by the inspector. Direct legacy values remain valid.
 */
export function getToolResultData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  let result = value as Record<string, unknown>
  if (result['result'] && typeof result['result'] === 'object' && !Array.isArray(result['result'])) {
    result = result['result'] as Record<string, unknown>
  }
  if (result['data'] && typeof result['data'] === 'object' && !Array.isArray(result['data'])) {
    result = result['data'] as Record<string, unknown>
  }

  return result
}

/**
 * Native invocations retain serialized JSON arguments, while live preparation
 * can contain unfinished JSON. Format only complete, reasonably sized values.
 */
export function toToolInput(value: JsonValue | undefined, complete = false): ToolContentPart | undefined {
  if (typeof value === 'string' && value.length <= MAXIMUM_FORMATTED_INPUT_CHARACTERS) {
    try {
      const parsed = JSON.parse(value) as JsonValue
      if (typeof parsed !== 'string') {
        return toToolContent(parsed, complete)
      }
    } catch {
      // Keep unfinished arguments visible as they arrive instead of hiding them.
    }
  }

  return toToolContent(value, complete)
}

/**
 * Gives live and mock values the same bounded text contract as saved tool bodies.
 * Terminal previews retain the tail so incoming lines do not disappear at the cap.
 */
export function toToolContent(value: JsonValue | undefined, complete = false, tail = false): ToolContentPart | undefined {
  if (value === undefined) {
    return undefined
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const truncated = !complete && text.length > TOOL_CONTENT_PREVIEW_CHARACTERS

  return {
    text: truncated ? (tail ? text.slice(-TOOL_CONTENT_PREVIEW_CHARACTERS) : text.slice(0, TOOL_CONTENT_PREVIEW_CHARACTERS)) : text,
    totalCharacters: text.length,
    truncated,
    language: typeof value === 'string' ? 'text' : 'json'
  }
}
