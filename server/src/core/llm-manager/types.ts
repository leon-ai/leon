import type {
  LlamaChatSession,
  LlamaChat,
  Token,
  ChatSessionModelFunctions,
  ChatHistoryItem
} from 'node-llama-cpp'

import type { MessageLog } from '@/types'

export enum LLMDuties {
  ActionRecognition = 'action-recognition',
  SkillRouter = 'skill-router',
  ActionCalling = 'action-calling',
  SlotFilling = 'slot-filling',
  CustomNER = 'custom-ner',
  Paraphrase = 'paraphrase',
  Conversation = 'conversation',
  Custom = 'custom'
  // TODO
  /*SentimentAnalysis = 'sentiment-analysis',
  QuestionAnswering = 'question-answering',
  IntentFallback = 'intent-fallback',
  RAG = 'rag',
  NLUParaphraser = 'nlu-paraphraser'*/
}

export enum LLMProviders {
  Local = 'local',
  Groq = 'groq'
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

export interface CompletionParams {
  dutyType: LLMDuties
  systemPrompt: string
  maxTokens?: number | undefined
  thoughtTokensBudget?: number | undefined
  grammar?: string
  temperature?: number | undefined
  timeout?: number
  maxRetries?: number
  session?: LlamaChatSession | LlamaChat | null
  functions?: ChatSessionModelFunctions | undefined
  data?: Record<string, unknown> | null
  history?: MessageLog[]
  onToken?: (tokens: Token[]) => void
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
