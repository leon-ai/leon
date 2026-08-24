import type {
  AgentResponsePlanStep,
  AgentResponseToolCall,
  AgentResponseTrace
} from '@/types'

import type { AgentRunProgressEvent } from './types'

/** Accumulates live agent progress into the compact trace persisted with a turn. */
export class AgentResponseTraceCollector {
  private reasoningSummary = ''
  private readonly planSteps = new Map<string, AgentResponsePlanStep>()
  private readonly toolCalls = new Map<string, AgentResponseToolCall>()

  public reset(): void {
    this.reasoningSummary = ''
    this.planSteps.clear()
    this.toolCalls.clear()
  }

  public record(event: AgentRunProgressEvent): void {
    if (event.type === 'reasoning_summary') {
      this.reasoningSummary = event.summary
      return
    }
    if (event.type === 'plan_step') {
      this.planSteps.set(event.step.id, { ...event.step })
      return
    }

    const existingToolCall = this.toolCalls.get(event.toolCall.id)
    this.toolCalls.set(event.toolCall.id, {
      ...existingToolCall,
      ...event.toolCall
    })
  }

  public snapshot(metrics: Record<string, unknown>): AgentResponseTrace {
    return {
      ...(this.reasoningSummary
        ? { reasoningSummary: this.reasoningSummary }
        : {}),
      planSteps: [...this.planSteps.values()].map((step) => ({ ...step })),
      toolCalls: [...this.toolCalls.values()].map((toolCall) => ({
        ...toolCall
      })),
      metrics: { ...metrics }
    }
  }
}
