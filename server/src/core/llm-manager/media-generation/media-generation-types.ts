import type { Artifact } from '@/core/artifacts/artifact-types'
import type { LLMProviders } from '@/core/llm-manager/types'

export enum MediaKind {
  Image = 'image',
  Document = 'document'
}

export enum GenerationStatus {
  SelectionRequired = 'selection_required',
  Completed = 'completed'
}

export interface MediaGenerationInput {
  session_id: string
  kind: MediaKind
  provider?: LLMProviders
  model?: string
  prompt: string
  filename?: string
  reference_artifact_ids?: string[]
  options?: Record<string, unknown>
  signal?: AbortSignal
}

export interface ResolvedMediaGenerationInput extends MediaGenerationInput {
  provider: LLMProviders
  model: string
}

export interface MediaGenerationResult {
  status: GenerationStatus
  artifacts: Artifact[]
  error?: string
  choices?: Array<{ provider: LLMProviders, models: string[] }>
}

export interface GeneratedFile {
  data: Uint8Array
  mime_type: string
  filename: string
}
