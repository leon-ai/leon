import {
  LLMDuties,
  type CompletionParams,
  type LLMPromptAbortReason,
  type OpenAIToolCall,
  type ProviderReasoningItem,
  type PromptOrChatHistory,
  type ProviderCompactionContext
} from '@/core/llm-manager/types'
import { type CompletionAccounting } from '@/core/llm-manager/llm-usage/usage-accounting'

/**
 * Public completion result returned to Leon duties.
 */
export interface CompletionResult {
  accounting?: CompletionAccounting | undefined
  dutyType: LLMDuties
  systemPrompt: string
  input: string
  output: string
  data: Record<string, unknown> | null
  maxTokens: number | undefined
  thoughtTokensBudget?: number
  usedInputTokens: number
  usedOutputTokens: number
  generationDurationMs: number
  firstTokenAt?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  temperature: number
  reasoning?: string
  reasoningItems?: ProviderReasoningItem[]
  compactionContext?: ProviderCompactionContext
  finishReason?: string
  /**
   * When the model responds through its tool-calling protocol,
   * this field contains the parsed tool_calls array.
   */
  toolCalls?: OpenAIToolCall[]
}

/**
 * Provider-independent content and accounting before display cleanup.
 */
export interface NormalizedCompletionResult {
  accounting?: CompletionAccounting | undefined
  rawResult: string
  usedInputTokens: number
  usedOutputTokens: number
  generationDurationMs?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  toolCalls?: OpenAIToolCall[]
  reasoning?: string
  reasoningItems?: ProviderReasoningItem[]
  compactionContext?: ProviderCompactionContext
  finishReason?: string
}

/**
 * An aborted attempt carrying the agent loop's retry instructions.
 */
export interface PromptAbortError extends Error {
  promptAbortReason?: LLMPromptAbortReason
}

/**
 * Runtime capabilities used by the provider coordinator.
 */
export interface Provider {
  modelName?: string
  compactionBinding?: string
  runChatCompletion: (
    promptOrChatHistory: PromptOrChatHistory,
    completionParams: CompletionParams
  ) => Promise<unknown>
  boot?: () => Promise<void>
  isServerReady?: () => boolean
  dispose?: () => void
}

/**
 * Completion parameters after duty defaults have been applied.
 */
export interface PreparedCompletionParams extends CompletionParams {
  timeout: number
  temperature: number
  data: Record<string, unknown> | null
  maxRetries: number
  remoteProviderErrorRetries: number
}
