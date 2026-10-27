import type {
  Token
} from 'node-llama-cpp'

import type { MessageLog } from '@/types'
import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

export enum LLMDuties {
  Inference = 'inference',
  SkillRouter = 'skill-router',
  ActionCalling = 'action-calling',
  SlotFilling = 'slot-filling',
  Paraphrase = 'paraphrase',
  ReAct = 'react'
  // TODO
  /*SentimentAnalysis = 'sentiment-analysis',
  QuestionAnswering = 'question-answering',
  IntentFallback = 'intent-fallback',
  RAG = 'rag',
  NLUParaphraser = 'nlu-paraphraser'*/
}

export enum InferencePurpose {
  ProviderTool = 'provider-tool',
  SessionTitle = 'session-title',
  Memory = 'memory',
  OwnerProfile = 'owner-profile',
  SelfModel = 'self-model',
  Pulse = 'pulse',
  PulsePlanning = 'pulse-planning',
  PulseReaction = 'pulse-reaction',
  ContextCompaction = 'context-compaction',
  ImageInspection = 'image-inspection'
}

export enum LLMProviders {
  LlamaCPP = 'llamacpp',
  SGLang = 'sglang',
  Groq = 'groq',
  OpenRouter = 'openrouter',
  ZAI = 'zai',
  DeepSeek = 'deepseek',
  MiniMax = 'minimax',
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  MoonshotAI = 'moonshotai',
  Cerebras = 'cerebras',
  HuggingFace = 'huggingface',
  Celeris = 'celeris'
}

export enum ActionCallingStatus {
  Success = 'success',
  MissingParams = 'missing_params',
  NotFound = 'not_found'
}
export enum SlotFillingStatus {
  Success = 'success',
  NotFound = 'not_found'
}

/**
 * Encoded evidence carried by owner messages or tool results.
 */
export interface AgentModelFile {
  dataBase64: string
  mediaType: string
  filename?: string
  visualDetail?: 'auto' | 'low' | 'high'
  /**
   * Keeps queued previews available across checkpoints until findings are saved.
   */
  inspectionPending?: boolean
}

/**
 * Provider-owned reasoning state retained for tool-call replay, never displayed.
 */
export interface ProviderReasoningItem {
  provider: LLMProviders
  id: string
  text: string
  encryptedContent?: string
  binding?: string
  providerOptions?: SharedV4ProviderOptions
}

/**
 * Retains assistant text boundaries and phases for the issuing provider route.
 */
export interface ProviderMessageMetadata {
  provider: LLMProviders
  binding: string
  parts: Array<{ text: string, phase?: 'commentary' | 'final_answer' }>
}

/**
 * Canonical provider window plus recoverable evidence for provider changes.
 */
export interface ProviderCompactionContext {
  provider: LLMProviders
  model: string
  binding: string
  output: Record<string, unknown>[]
  estimatedTokens: number
  sourceTranscript: AgentToolTranscriptMessage[]
}

/**
 * Canonical agent transcript. Preserve tool protocol roles and attachments
 * instead of rewriting each exchange into a text-only phase prompt.
 */
export type AgentToolTranscriptMessage =
  | {
      role: 'user'
      content: string
      files?: AgentModelFile[]
      // Host-owned state deltas preserve append-only provider history.
      runtimeContext?: Record<string, unknown>
    }
  | {
      role: 'assistant'
      content: string
      reasoning?: string
      reasoningItems?: ProviderReasoningItem[]
      providerMessage?: ProviderMessageMetadata
      compactionContext?: ProviderCompactionContext
      toolCalls?: OpenAIToolCall[]
    }
  | {
      role: 'tool'
      toolCallId: string
      toolName: string
      content: string
      files?: AgentModelFile[]
    }

export type PromptOrChatHistory = string | AgentToolTranscriptMessage[]

/**
 * OpenAI-compatible tool definition for providers that support tool calling.
 */
export interface OpenAIToolFunction {
  name: string
  description?: string
  parameters: Record<string, unknown>
}
export interface OpenAITool {
  type: 'function'
  function: OpenAIToolFunction
}
export type OpenAIToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      type: 'function'
      function: {
        name: string
      }
    }

/**
 * Represents a tool call returned by the model's tool-calling protocol.
 */
export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type LLMReasoningMode = 'off' | 'guarded' | 'on'
export type LLMReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
export type LLMReasoningSummary = 'auto' | 'detailed'
export type LLMTextVerbosity = 'low' | 'medium' | 'high'
export type LLMPromptCacheRetention = 'in_memory' | '24h'
export type LLMServiceTier = 'auto' | 'flex' | 'priority' | 'default'

export interface LLMPromptAbortReason {
  shouldRetry: boolean
  retryStrategy: 'timeout'
  source: 'agent_tool_call_diagnosis'
  delayMs: number
}

/**
 * Transport and protocol progress without prompt content or credentials.
 */
export interface CompletionStreamEvent {
  type: string
  requestBytes?: number
  uploadDurationMs?: number
  providerEventType?: string
  transport?: 'http' | 'websocket'
  requestId?: string
  responseId?: string
  requestAccepted?: boolean
  providerCompleted?: boolean
  heartbeat?: {
    pingCount: number
    pongCount: number
    lastPingAt?: number | undefined
    lastPongAt?: number | undefined
    lastPongRttMs?: number | undefined
  }
  toolCallId?: string
  providerExecuted?: boolean
  /**
   * Intermediate text expects a continuation; tool results may also be provisional.
   */
  preliminary?: boolean
  promptCache?: PromptCacheObservation
}

/**
 * Describes consecutive wire requests using fingerprints, never prompt content.
 */
export interface PromptCacheObservation {
  key: string
  systemHash: string
  toolsHash: string
  inputItems: number
  previousInputItems: number
  matchingPrefixItems: number
  changedInputs: string[]
  toolChanges?: {
    added: number
    removed: number
    modified: number
    reordered: boolean
  }
  inputTokens?: number
  cachedInputTokens?: number
}

export enum CompletionFailureKind {
  Timeout = 'timeout',
  Context = 'context',
  Unavailable = 'unavailable',
  Provider = 'provider'
}

export enum ProviderRetryDecision {
  Retry = 'retry',
  Stop = 'stop'
}

export enum ProviderRetryReason {
  Connection = 'connection_failure',
  Accepted = 'accepted_request_outcome_unknown',
  Transient = 'quick_transient_failure',
  Compatibility = 'provider_compatibility',
  Size = 'unchanged_payload_too_large',
  Completed = 'provider_already_completed',
  Output = 'partial_output_received',
  Slow = 'failure_exceeded_retry_window',
  Exhausted = 'retry_budget_exhausted',
  Deadline = 'insufficient_remaining_time',
  Permanent = 'non_transient_failure'
}

/**
 * Distinguishes transport waits, generation and retry decisions without prompt content.
 */
export interface ProviderActivitySnapshot {
  providerRequestId?: string | undefined
  transport?: 'http' | 'websocket' | 'local' | undefined
  requestId?: string | undefined
  responseId?: string | undefined
  requestBytes?: number | undefined
  uploadDurationMs?: number | undefined
  requestAcceptedMs?: number | undefined
  firstProviderEventMs?: number | undefined
  lastProviderEvent?: string | undefined
  lastProviderEventMs?: number | undefined
  providerIdleMs?: number | undefined
  providerEventCount: number
  providerCompleted: boolean
  failureSummary?: string | undefined
  firstOutputMs?: number | undefined
  outputPreliminary?: boolean | undefined
  pingCount?: number | undefined
  pongCount?: number | undefined
  lastPingAgeMs?: number | undefined
  lastPongAgeMs?: number | undefined
  lastPongRttMs?: number | undefined
  retryDecision?: ProviderRetryDecision | undefined
  retryReason?: ProviderRetryReason | undefined
  elapsedMs: number
}

export interface CompletionAttemptTiming extends Omit<ProviderActivitySnapshot, 'providerEventCount' | 'providerCompleted'> {
  attemptId: string
  startedAt: number
  provider: LLMProviders
  model?: string | undefined
  duty: LLMDuties
  usagePurpose?: InferencePurpose | undefined
  reasoningEffort?: LLMReasoningEffort | undefined
  serviceTier?: LLMServiceTier | undefined
  transport: 'http' | 'websocket' | 'local'
  outcome: string
  failureKind?: CompletionFailureKind | undefined
  connectionErrorCode?: string | undefined
  promptCache?: PromptCacheObservation | undefined
  inferenceTimeoutMs: number
  streamIdleTimeoutMs: number
  generationStartMs?: number | undefined
  requestDispatchMs?: number | undefined
  responseHeadersMs?: number | undefined
  firstByteMs?: number | undefined
  /**
   * The SDK has opened its parsed stream; response bytes may arrive earlier.
   */
  streamOpenMs?: number | undefined
  firstEventMs?: number | undefined
  firstTokenMs?: number | undefined
  firstReasoningTokenMs?: number | undefined
  firstToolInputMs?: number | undefined
  lastEvent: string
  idleMs?: number | undefined
  transportIdleMs?: number | undefined
  outputIdleMs?: number | undefined
}

export interface CompletionParams {
  dutyType: LLMDuties
  usagePurpose?: InferencePurpose
  systemPrompt: string
  maxTokens?: number | undefined
  thoughtTokensBudget?: number | undefined
  temperature?: number | undefined
  seed?: number | undefined
  timeout?: number
  /**
   * Maximum silence after output starts; independent of initial inference.
   */
  streamIdleTimeout?: number
  signal?: AbortSignal
  /**
   * Cancels the whole request, including retries after an attempt-level abort.
   */
  cancellationSignal?: AbortSignal
  maxRetries?: number
  data?: Record<string, unknown> | null
  history?: MessageLog[]
  onToken?: (tokens: Token[] | string) => void
  onReasoningToken?: (reasoningChunk: string) => void
  onStreamEvent?: (event: CompletionStreamEvent) => void
  /**
   * Reports dispatch and terminal timings for every attempt, including retries.
   */
  onAttempt?: (timing: CompletionAttemptTiming) => void
  /**
   * Provisional function arguments for display while the model is generating.
   * Execute only the completed tool calls returned by the completion.
   */
  onToolCall?: (toolCall: OpenAIToolCall) => void
  shouldStream?: boolean
  /**
   * Optional provider hint to disable thinking/reasoning for a request.
   * The core may also enable this proactively for compatibility when
   * tool_choice is forced.
   */
  disableThinking?: boolean
  /**
   * Optional provider-agnostic reasoning mode for remote providers.
   * This is more expressive than the legacy disableThinking boolean.
   */
  reasoningMode?: LLMReasoningMode
  /**
   * Exact provider-normalized reasoning effort, when the model supports it.
   */
  reasoningEffort?: LLMReasoningEffort
  /**
   * Keeps the request's normal effort stable when an adapter can apply the
   * requested effort to the latest turn without invalidating cached history.
   * "on" retains the adapter's normal enabled-thinking default.
   */
  reasoningEffortBaseline?: LLMReasoningEffort | 'on'
  /**
   * Enable reasoning while leaving the effort at the provider's model default.
   */
  reasoningUseDefaultEffort?: boolean
  reasoningSummary?: LLMReasoningSummary | undefined
  textVerbosity?: LLMTextVerbosity | undefined
  promptCacheKey?: string | undefined
  promptCacheRetention?: LLMPromptCacheRetention | undefined
  serviceTier?: LLMServiceTier | undefined
  /**
   * Optional compatibility flag to relax a forced tool_choice into `auto`
   * for providers that reject specified tool_choice values.
   */
  relaxForcedToolChoice?: boolean
  /**
   * When false, provider prompt failures are kept local to the caller:
   * no user-facing error talk and no mutation of the global last-provider-error
   * state. Useful for background/auxiliary inferences.
   */
  trackProviderErrors?: boolean
  /**
   * Disables automatic provider compaction during portable context recovery.
   */
  disableContextCompaction?: boolean
  /**
   * Transient failure budget shared by timeout and transport recovery.
   */
  remoteProviderErrorRetries?: number
  /**
   * Remaining connection recovery attempts before provider acceptance.
   */
  connectionErrorRetries?: number
  connectionRetryAttempt?: number
  /**
   * Reports each connection retry before waiting, without another model call.
   */
  onConnectionRetry?: (notice: {
    attempt: number
    maxRetries: number
    delayMs: number
  }) => Promise<void> | void
  /**
   * Recomputes the retry wait from the caller's remaining work budget.
   * Returning zero preserves time for delivery instead of dispatching a retry.
   */
  getRetryTimeout?: (timeoutMs: number) => number
  /**
   * OpenAI-compatible tools for providers that support tool calling. When set,
   * the provider sends these as `tools`
   * in the API request instead of (or in addition to) JSON mode.
   */
  tools?: OpenAITool[]
  toolChoice?: OpenAIToolChoice
}

/**
 * Possible output:
 * missing params: {"status": "missing_params", "required_params": ["<param_name_1>", "<param_name_2>"], "name": "<function_name>"}
 * not found: {"status": "not_found"}
 * success: {"name": "create_list", "arguments": {"list_name": "chore"}}
 */
export interface ActionCallingMissingParamsOutput {
  status: ActionCallingStatus.MissingParams
  required_params: string[]
  name: string
  arguments: Record<string, string> | object
}
export interface ActionCallingNotFoundOutput {
  status: ActionCallingStatus.NotFound
}
export interface ActionCallingSuccessOutput {
  status: ActionCallingStatus.Success
  name: string
  arguments: Record<string, unknown>
}
export type ActionCallingOutput =
  | ActionCallingMissingParamsOutput
  | ActionCallingNotFoundOutput
  | ActionCallingSuccessOutput

export interface SlotFillingNotFoundOutput {
  status: SlotFillingStatus.NotFound
}
export interface SlotFillingSuccessOutput {
  status: SlotFillingStatus.Success
  name: string
  filled_slots: Record<string, string>
}
export type SlotFillingOutput =
  | SlotFillingNotFoundOutput
  | SlotFillingSuccessOutput
