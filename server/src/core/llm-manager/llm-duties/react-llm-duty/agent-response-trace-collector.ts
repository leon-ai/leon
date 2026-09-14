import type {
  AgentResponsePlanStep,
  AgentResponsePlanTransition,
  AgentResponseToolCall,
  AgentResponseTrace
} from '@/types'

import type { AgentRunProgressEvent } from './types'

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
  private readonly planSteps = new Map<string, AgentResponsePlanStep>()
  private readonly planTransitions: AgentResponsePlanTransition[] = []
  private readonly toolCalls = new Map<string, AgentResponseToolCall>()

  public reset(id?: string): void {
    this.id = id
    this.reasoning.clear()
    this.reasoningSummary = ''
    this.planSteps.clear()
    this.planTransitions.length = 0
    this.toolCalls.clear()
  }

  public record(event: AgentRunProgressEvent): void {
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
    this.toolCalls.set(event.toolCall.id, {
      ...existingToolCall,
      ...event.toolCall,
      startedAt: existingToolCall?.startedAt ?? Date.now()
    })
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
      if (toolCall.status === 'running') {
        toolCall.status = 'error'
        toolCall.errorMessage = 'The turn ended before this function completed.'
      }
    }
  }

  public snapshot(metrics: Record<string, unknown>): AgentResponseTrace {
    return {
      ...(this.id ? { id: this.id } : {}),
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
