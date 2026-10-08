import type {
  AgentResponsePlanStep,
  AgentResponsePlanTransition,
  AgentResponseToolCall,
  AgentResponseTrace
} from '@/types'

import type { AgentRunProgressEvent } from './agent-types'

/**
 * Accumulates live agent progress into the compact trace persisted with a turn.
 */
export class AgentResponseTraceCollector {
  private id: string | undefined
  private readonly reasoning = new Map<
    string,
    NonNullable<AgentResponseTrace['reasoning']>[number]
  >()
  private reasoningSummary = ''
  private readonly progressMessages = new Map<
    string,
    NonNullable<AgentResponseTrace['progressMessages']>[number]
  >()
  private readonly planSteps = new Map<string, AgentResponsePlanStep>()
  private readonly planTransitions: AgentResponsePlanTransition[] = []
  private readonly toolCalls = new Map<string, AgentResponseToolCall>()
  private readonly inferences = new Map<
    string,
    NonNullable<AgentResponseTrace['inferences']>[number]
  >()

  public reset(id?: string): void {
    this.id = id
    this.reasoning.clear()
    this.reasoningSummary = ''
    this.progressMessages.clear()
    this.planSteps.clear()
    this.planTransitions.length = 0
    this.toolCalls.clear()
    this.inferences.clear()
  }

  public record(event: AgentRunProgressEvent): void {
    if (event.type === 'progress_message') {
      this.progressMessages.set(event.message.id, { ...event.message })
      return
    }
    if (event.type === 'reasoning_summary') {
      this.reasoningSummary = event.summary
      return
    }
    if (event.type === 'plan_step') {
      const previousStep = this.planSteps.get(event.step.id)

      // Preserve an audit trail without duplicating unchanged plan snapshots.
      if (
        previousStep?.label !== event.step.label ||
        previousStep.status !== event.step.status
      ) {
        this.planTransitions.push({
          ...event.step,
          changedAt: Date.now()
        })
      }

      this.planSteps.set(event.step.id, { ...event.step })
      return
    }

    const existingToolCall = this.toolCalls.get(event.toolCall.id)
    const toolCall = {
      ...existingToolCall,
      ...event.toolCall
    }

    // Argument streaming can be long; execution time starts at dispatch.
    if (toolCall.status === 'preparing') {
      toolCall.preparationStartedAt ??= Date.now()
    } else if (toolCall.status === 'running' || toolCall.preparationStartedAt === undefined) {
      toolCall.startedAt ??= Date.now()
    }

    this.toolCalls.set(event.toolCall.id, toolCall)
  }

  /**
   * Keep each retry separate while replacing its initial timing with its outcome.
   */
  public recordInference(
    timing: NonNullable<AgentResponseTrace['inferences']>[number]
  ): void {
    this.inferences.set(timing.attemptId, { ...timing })
  }

  /**
   * Keep only reasoning tokens that were actually displayed to the owner.
   */
  public recordReasoning(id: string, text: string, phase: string): void {
    const existing = this.reasoning.get(id)
    this.reasoning.set(id, {
      id,
      text: (existing?.text || '') + text,
      phase,
      startedAt: existing?.startedAt ?? Date.now()
    })
  }

  /**
   * An interrupted turn must not replay unfinished calls as successful.
   */
  public interrupt(): void {
    for (const toolCall of this.toolCalls.values()) {
      if (toolCall.status === 'preparing' || toolCall.status === 'running') {
        toolCall.status = 'error'
        toolCall.errorMessage = 'The turn ended before this function completed.'
      }
    }
  }

  public snapshot(metrics: Record<string, unknown>): AgentResponseTrace {
    return {
      ...(this.id ? { id: this.id } : {}),
      ...(this.inferences.size > 0
        ? {
            inferences: [...this.inferences.values()].map((timing) => ({ ...timing }))
          }
        : {}),
      ...(this.progressMessages.size > 0
        ? {
            progressMessages: [...this.progressMessages.values()].map((message) => ({ ...message }))
          }
        : {}),
      ...(this.reasoning.size > 0
        ? { reasoning: [...this.reasoning.values()].map((block) => ({ ...block })) }
        : {}),
      ...(this.reasoningSummary
        ? { reasoningSummary: this.reasoningSummary }
        : {}),
      planSteps: [...this.planSteps.values()].map((step) => ({ ...step })),
      ...(this.planTransitions.length > 0
        ? {
            planTransitions: this.planTransitions.map((transition) => ({
              ...transition
            }))
          }
        : {}),
      toolCalls: [...this.toolCalls.values()].map((toolCall) => ({
        ...toolCall
      })),
      metrics: { ...metrics }
    }
  }
}
