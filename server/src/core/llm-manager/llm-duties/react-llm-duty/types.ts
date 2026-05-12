import type { LLMDutyParams } from '@/core/llm-manager/llm-duty'
import type { MessageLog } from '@/types'
import type {
  LLMReasoningMode,
  OpenAITool,
  OpenAIToolChoice
} from '@/core/llm-manager/types'

export interface AgentSkillContext {
  id: string
  name: string
  description: string
  rootPath: string
  skillPath: string
  instructions: string
}

export interface ReactLLMDutyParams extends LLMDutyParams {
  agentSkill?: AgentSkillContext | null
  forcedToolName?: string | null
}

export interface FunctionConfig {
  description: string
  parameters: Record<string, unknown>
  output_schema?: Record<string, unknown>
  hooks?: {
    post_execution?: {
      response_jq?: string
    }
  }
}

export type ToolFunctionsMap = Record<string, FunctionConfig>

export interface PlanStep {
  function: string
  label: string
  agentSkillId?: string
}

export interface ExecutionRecord {
  function: string
  status: string
  observation: string
  stepLabel?: string
  requestedToolInput?: string
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export interface TrackedPlanStep {
  label: string
  status: PlanStepStatus
}

export interface Catalog {
  text: string
  mode: 'function' | 'tool'
}

export type FinalPhaseIntent =
  | 'answer'
  | 'clarification'
  | 'cancelled'
  | 'blocked'
  | 'error'

export interface FinalResponseSignal {
  intent: FinalPhaseIntent
  draft: string
  source:
    | 'planning'
    | 'execution'
    | 'recovery'
    | 'self_observation'
    | 'tool'
    | 'system'
}

export type PlanResult =
  | { type: 'plan', steps: PlanStep[], summary: string }
  | { type: 'handoff', signal: FinalResponseSignal }

export type ExecutionStepResult =
  | { type: 'handoff', signal: FinalResponseSignal }
  | { type: 'replan', reason: string, steps: PlanStep[] }
  | {
      type: 'executed'
      execution: ExecutionRecord
      handoffSignal?: FinalResponseSignal
    }

export interface ToolExecutionResult {
  type: 'executed'
  execution: ExecutionRecord
  handoffSignal?: FinalResponseSignal
}

export interface PromptLogSection {
  name: string
  source: string
  content?: string
}

export type ReactPhase = 'planning' | 'execution' | 'recovery' | 'final_answer'

export interface LLMCallOptions {
  phase?: ReactPhase
  disableThinking?: boolean
  reasoningMode?: LLMReasoningMode
  emitReasoning?: boolean
  streamToProvider?: boolean
  streamToUser?: boolean
}

/**
 * Callback interface for LLM calls from phase functions.
 * This decouples the phase logic from the duty class instance.
 */
export interface LLMCaller {
  callLLM(
    prompt: string,
    systemPrompt: string,
    schema: Record<string, unknown>,
    history?: MessageLog[],
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    output: unknown
    usedInputTokens?: number
    usedOutputTokens?: number
    reasoning?: string
  } | null>

  callLLMText(
    prompt: string,
    systemPrompt: string,
    history?: MessageLog[],
    shouldStream?: boolean,
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    output: string
    usedInputTokens?: number
    usedOutputTokens?: number
    reasoning?: string
  } | null>

  callLLMWithTools(
    prompt: string,
    systemPrompt: string,
    tools: OpenAITool[],
    toolChoice?: OpenAIToolChoice,
    history?: MessageLog[],
    shouldStreamToUser?: boolean,
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    toolCall?: { functionName: string, arguments: string }
    unexpectedToolCall?: { functionName: string, arguments: string }
    textContent?: string
    usedInputTokens?: number
    usedOutputTokens?: number
    reasoning?: string
  } | null>

  readonly supportsNativeTools: boolean
  readonly input: string | object | null
  readonly history: MessageLog[]
  readonly agentSkillContext?: AgentSkillContext | null
  readonly agentSkillCatalog: string
  setAgentSkillContext(context: AgentSkillContext): void
  getAgentSkillContext(skillId: string): Promise<AgentSkillContext | null>
  getContextFileContent(filename: string): string | null
  getContextManifest(): string
  getSelfModelSnapshot(): string
  consumeProviderErrorMessage(): string | null
}
