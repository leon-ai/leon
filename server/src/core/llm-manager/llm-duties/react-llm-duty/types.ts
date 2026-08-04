import type { LLMDutyParams } from '@/core/llm-manager/llm-duty'
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
  allowDirectAnswerHandoff?: boolean
  additionalInstructions?: string
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
