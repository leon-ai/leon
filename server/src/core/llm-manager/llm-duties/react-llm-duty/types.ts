import type { LLMDutyParams } from '@/core/llm-manager/llm-duty'
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
      toolCall: {
        id: string
        name: string
        status: 'running' | 'success' | 'error'
        input?: unknown
        output?: unknown
        stepLabel?: string
        errorMessage?: string
        skillId?: string
        nativeSkillPath?: string
      }
    }

export interface ReactLLMDutyParams extends LLMDutyParams {
  agentSkill?: AgentSkillContext | null
  forcedToolName?: string | null
  allowDirectAnswerHandoff?: boolean
  additionalInstructions?: string
  onProgressEvent?: (event: AgentRunProgressEvent) => void
}

export interface FunctionConfig {
  description: string
  parameters: Record<string, unknown>
  output_schema?: Record<string, unknown>
  deduplicate_calls?: boolean
  hooks?: {
    post_execution?: {
      response_jq?: string
    }
  }
}

export interface ExecutionRecord {
  function: string
  status: string
  observation: string
  toolCallTitle?: string
  stepLabel?: string
  requestedToolInput?: string
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export interface TrackedPlanStep {
  label: string
  status: PlanStepStatus
}

export type FinalPhaseIntent =
  | 'answer'
  | 'clarification'
  | 'blocked'
  | 'error'

export interface FinalResponseSignal {
  intent: FinalPhaseIntent
  draft: string
}

export interface ToolExecutionResult {
  execution: ExecutionRecord
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
