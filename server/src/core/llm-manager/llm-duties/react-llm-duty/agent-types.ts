import type { LLMDutyParams } from '@/core/llm-manager/llm-duty'
import type { ToolCompletionReview, AgentResponseToolCall  } from '@/types'
import type { AgentModelFile } from '@/core/llm-manager/types'
import type { LeonClientInterfaceTokenPayload } from '@/core/leon-interface/types'
import type { InferenceActivity } from '@/core/llm-manager/turn-timing-contract'
export interface AgentSkillContext {
  id: string
  name: string
  description: string
  rootPath: string
  skillPath: string
  instructions: string
}

export type AgentRunProgressEvent =
  | {
      type: 'inference_activity'
      activity: InferenceActivity
    }
  | {
      type: 'progress_message'
      message: { id: string, content: string, createdAt: number, planStepId?: string | null }
    }
  | {
      type: 'reasoning_summary'
      summary: string
    }
  | {
      type: 'plan_step'
      step: {
        id: string
        label: string
        status: PlanStepStatus
      }
    }
  | {
      type: 'tool_call'
      toolCall: AgentResponseToolCall
    }

export interface ReactLLMDutyParams extends LLMDutyParams {
  files?: AgentModelFile[]
  signal?: AbortSignal
  /**
   * Optional absolute run deadline, shared by tools, inference and completion review.
   */
  deadlineAt?: number
  agentSkill?: AgentSkillContext | null
  forcedToolName?: string | null
  allowDirectAnswerHandoff?: boolean
  additionalInstructions?: string
  onProgressEvent?: (event: AgentRunProgressEvent) => void
  responseId?: string
  onTextStream?: (kind: 'answer' | 'reasoning', payload: LeonClientInterfaceTokenPayload) => void
}

export interface FunctionConfig {
  description: string
  progressive_guidance?: string
  parameters: Record<string, unknown>
  output_schema?: Record<string, unknown>
  deduplicate_calls?: boolean
  read_only?: boolean
  background?: boolean
  completion_review?: ToolCompletionReview
  hooks?: {
    post_execution?: {
      response_jq?: string
    }
  }
}

export interface ExecutionRecord {
  function: string
  toolkitName?: string
  toolName?: string
  status: string
  observation: string
  startedAt?: number
  completedAt?: number
  durationMs?: number
  toolCallTitle?: string
  stepLabel?: string
  requestedToolInput?: string
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export interface TrackedPlanCollection {
  scope: string
  enumeration: 'in_progress' | 'completed'
  evidence: string
  cursor?: string
  items: Array<{ id: string, status: PlanStepStatus, details?: string }>
}

export interface TrackedPlanStep {
  label: string
  status: PlanStepStatus
  details?: string
  collection?: TrackedPlanCollection
}

export type FinalPhaseIntent =
  | 'answer'
  | 'cancelled'
  | 'clarification'
  | 'blocked'
  | 'error'

export interface FinalResponseSignal {
  intent: FinalPhaseIntent
  draft: string
}

export interface ToolExecutionResult {
  execution: ExecutionRecord
  executionHandle?: { id: string, state: string }
  modelFiles?: Array<{
    dataBase64: string
    mediaType: string
    filename?: string
    visualDetail?: 'auto' | 'low' | 'high'
  }>
  handoffSignal?: FinalResponseSignal
}

export type AgentPhase = 'agent' | 'final_answer'

export interface LLMCaller {
  readonly agentSkillContext?: AgentSkillContext | null
  readonly agentSkillCatalog: string
  setAgentSkillContext(context: AgentSkillContext): void
  getContextFileContent(filename: string): string | null
  getContextManifest(): string
  getSelfModelSnapshot(): string
  getPreviousToolArtifacts?(): Promise<string>
}
