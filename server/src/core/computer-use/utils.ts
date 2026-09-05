import type { CuaToolResult } from './types'

/** Cua also exposes informational activation codes in its errorCode field. */
export function hasCuaError(result: CuaToolResult): boolean {
  if (result.isError) return true
  if (!result.errorCode) return false
  const output = parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
  return output?.['activated'] !== true && output?.['success'] !== true
}

/** Returns a plain object view when the input is a JSON record. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Parses one optional JSON object without throwing into tool execution. */
export function parseJsonRecord(
  value?: string
): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

export function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
