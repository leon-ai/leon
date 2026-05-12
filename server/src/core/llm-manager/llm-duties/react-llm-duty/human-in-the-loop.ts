import type {
  ExecutionRecord,
  FinalResponseSignal,
  PlanStep,
  PlanStepStatus,
  TrackedPlanStep
} from './types'

export const REACT_CONTINUATION_MAX_AGE_MS = 30 * 60 * 1_000

export interface ReactExecutionContinuationState {
  version: 1
  phase: 'execution'
  planWidgetId: string
  originalInput: string
  clarificationQuestion: string
  pendingSteps: PlanStep[]
  executionHistory: ExecutionRecord[]
  trackedSteps: TrackedPlanStep[]
  currentStepIndex: number
  replanCount: number
  executionCount: number
  createdAt: number
}

export interface ReactExecutionContinuationPayload {
  state: ReactExecutionContinuationState
  resumedInput: string
}

export interface CreateExecutionContinuationStateParams {
  planWidgetId: string
  originalInput: string
  clarificationQuestion: string
  currentStep: PlanStep
  pendingSteps: PlanStep[]
  executionHistory: ExecutionRecord[]
  trackedSteps: TrackedPlanStep[]
  currentStepIndex: number
  replanCount: number
  executionCount: number
}

export function buildPausedTrackedSteps(
  trackedSteps: TrackedPlanStep[],
  inProgressIndex: number
): TrackedPlanStep[] {
  if (trackedSteps.length === 0) {
    return []
  }

  const normalizedIndex = Math.min(
    Math.max(inProgressIndex, 0),
    trackedSteps.length - 1
  )

  return trackedSteps.map((step, index) => {
    if (index < normalizedIndex) {
      return { ...step, status: 'completed' as PlanStepStatus }
    }
    if (index === normalizedIndex) {
      return { ...step, status: 'in_progress' as PlanStepStatus }
    }

    return { ...step, status: 'pending' as PlanStepStatus }
  })
}

export function buildResumedExecutionInput(
  originalInput: string,
  clarificationQuestion: string,
  ownerReply: string
): string {
  return `${originalInput}\n\nPrevious clarification request: "${clarificationQuestion}"\nClarification reply: "${ownerReply}"`
}

export function isExecutionContinuationStateValid(
  state: ReactExecutionContinuationState,
  now = Date.now()
): boolean {
  if (!state.createdAt || now - state.createdAt > REACT_CONTINUATION_MAX_AGE_MS) {
    return false
  }

  return state.phase === 'execution' && Array.isArray(state.pendingSteps)
}

function copyPlanStep(step: PlanStep): PlanStep {
  return {
    function: step.function,
    label: step.label,
    ...(step.agentSkillId ? { agentSkillId: step.agentSkillId } : {})
  }
}

export function createExecutionContinuationState(
  params: CreateExecutionContinuationStateParams
): ReactExecutionContinuationState {
  return {
    version: 1,
    phase: 'execution',
    planWidgetId: params.planWidgetId,
    originalInput: params.originalInput,
    clarificationQuestion: params.clarificationQuestion,
    pendingSteps: [params.currentStep, ...params.pendingSteps].map(copyPlanStep),
    executionHistory: params.executionHistory.map((item) => ({ ...item })),
    trackedSteps: params.trackedSteps.map((step) => ({ ...step })),
    currentStepIndex:
      params.trackedSteps.length > 0
        ? Math.min(params.currentStepIndex, params.trackedSteps.length - 1)
        : 0,
    replanCount: params.replanCount,
    executionCount: params.executionCount,
    createdAt: Date.now()
  }
}

export function shouldContinueAfterIntermediateAnswerHandoff(
  signal: FinalResponseSignal,
  pendingSteps: PlanStep[]
): boolean {
  return signal.intent === 'answer' && pendingSteps.length > 0
}

export function createIntermediateAnswerExecutionRecord(
  currentStep: PlanStep,
  signal: FinalResponseSignal
): ExecutionRecord {
  return {
    function: currentStep.function,
    status: 'success',
    observation: signal.draft,
    stepLabel: currentStep.label
  }
}
