import { Type, type Static } from '@sinclair/typebox'

export const MAXIMUM_GENERATED_SOURCE_CHARACTERS = 65_536
export const MAXIMUM_GENERATED_STATE_CHARACTERS = 16_384
export const MAXIMUM_GENERATED_HEIGHT = 1_200
export const MINIMUM_GENERATED_HEIGHT = 120
export const GENERATED_BRIDGE_VERSION = 'aurora-generated-v1'

export const generatedSourceProperties = {
  html: Type.String({ minLength: 1, maxLength: 24_576 }),
  css: Type.Optional(Type.String({ maxLength: 12_288 })),
  javascript: Type.Optional(Type.String({ maxLength: 32_768 })),
  fallback: Type.String({ minLength: 1, maxLength: 8_192 }),
  height: Type.Optional(Type.Integer({ minimum: MINIMUM_GENERATED_HEIGHT, maximum: MAXIMUM_GENERATED_HEIGHT }))
}

export const generatedSourceSchema = Type.Object(generatedSourceProperties, { additionalProperties: false })
export type GeneratedSource = Static<typeof generatedSourceSchema>

export enum GeneratedMessage {
  Ready = 'ready',
  Rendered = 'rendered',
  Initialize = 'initialize',
  Context = 'context',
  Resize = 'resize',
  State = 'state',
  Submit = 'submit',
  Charts = 'charts',
  Controls = 'controls',
  Export = 'export',
  Error = 'error'
}

/**
 * Limits retained state to small JSON objects; a surface cannot persist DOM,
 * executable values or an unbounded stream of interaction history.
 */
export function isGeneratedState(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  try {
    return JSON.stringify(value).length <= MAXIMUM_GENERATED_STATE_CHARACTERS
  } catch {
    return false
  }
}
