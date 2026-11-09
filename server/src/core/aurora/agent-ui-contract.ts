export const AGENT_CLARIFICATION_TOOL_NAME = 'request_clarification'
export const AURORA_LOADER_NAME = 'load_ui'
export const AURORA_PRESENT_NAME = 'present_ui'
export const AURORA_PREVIEW_NAME = 'preview_ui'

export enum AuroraMode {
  Input = 'input',
  Native = 'native',
  Generated = 'generated'
}

/**
 * Validates persisted capabilities before rebuilding model-facing contracts.
 */
export function isAuroraMode(value: unknown): value is AuroraMode {
  return Object.values(AuroraMode).includes(value as AuroraMode)
}
