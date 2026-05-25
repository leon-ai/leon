import type {
  LlamaChatSession,
  LlamaChat,
  Token,
  ChatSessionModelFunctions,
  ChatHistoryItem
} from 'node-llama-cpp'

import type { MessageLog } from '@/types'

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

export enum LLMProviders {
  Local = 'local',
  LlamaCPP = 'llamacpp',
  SGLang = 'sglang',
  Groq = 'groq',
  OpenRouter = 'openrouter',
  ZAI = 'zai',
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  MoonshotAI = 'moonshotai',
  Cerebras = 'cerebras',
  HuggingFace = 'huggingface'
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

export type PromptOrChatHistory = string | ChatHistoryItem[]

/**
 * OpenAI-compatible tool definition for remote providers that support
 * native tool/function calling (e.g. OpenRouter).
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
 * Represents a tool call returned by the model when using native tool calling.
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

export interface LLMPromptAbortReason {
  shouldRetry: boolean
  retryStrategy: 'timeout'
  source: 'react_tool_call_diagnosis'
  delayMs: number
}

export interface CompletionParams {
  dutyType: LLMDuties
  systemPrompt: string
  maxTokens?: number | undefined
  thoughtTokensBudget?: number | undefined
  grammar?: string
  temperature?: number | undefined
  timeout?: number
  signal?: AbortSignal
  maxRetries?: number
  session?: LlamaChatSession | LlamaChat | null
  functions?: ChatSessionModelFunctions | undefined
  data?: Record<string, unknown> | null
  history?: MessageLog[]
  onToken?: (tokens: Token[] | string) => void
  onReasoningToken?: (reasoningChunk: string) => void
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
   * Internal retry budget for remote provider failures handled by the central
   * LLM provider wrapper.
   */
  remoteProviderErrorRetries?: number
  /**
   * OpenAI-compatible tools for remote providers that support native
   * tool/function calling. When set, the provider sends these as `tools`
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
