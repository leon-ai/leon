export type ModelReasoning =
  | 'auto'
  | 'on'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type ModelSpeed = 'auto' | 'normal' | 'fast'

export interface ModelOption {
  model: string
  label: string
  recommended: boolean
  reasoning: readonly ModelReasoning[]
  speed: readonly ModelSpeed[]
  defaultReasoningLabel: string
  defaultReasoningEffort?: Exclude<ModelReasoning, 'auto' | 'on'>
}

export interface ModelProvider {
  id: string
  label: string
  models: readonly ModelOption[]
}

export interface ModelChoice {
  provider: ModelProvider
  model: ModelOption
}

export interface ModelSettings {
  reasoning: ModelReasoning
  speed: ModelSpeed
}

// Vite projects the curated catalog at build time; no Core runtime or profile
// credentials are loaded by the browser.
declare const LEON_MODEL_PROVIDERS: readonly ModelProvider[]

export const modelProviders = LEON_MODEL_PROVIDERS
