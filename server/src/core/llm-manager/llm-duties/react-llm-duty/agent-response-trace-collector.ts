import type {
  AgentResponsePlanStep,
  AgentResponsePlanTransition,
  AgentResponseToolCall,
  AgentResponseTrace
} from '@/types'

import type { AgentRunProgressEvent } from './agent-types'
import { getTurnTimings } from '../../turn-timing'

/**
 * Accumulates live agent progress into the compact trace persisted with a turn.
 */
export class AgentResponseTraceCollector {
  private id: string | undefined
  private answerStartedAt: number | undefined
  private answerGeneration: string | undefined
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
  private readonly inferenceSteps = new Map<string, string | null>()
  private readonly planTransitions: AgentResponsePlanTransition[] = []
  private readonly toolCalls = new Map<string, AgentResponseToolCall>()
  private readonly inferences = new Map<
    string,
    NonNullable<AgentResponseTrace['inferences']>[number]
  >()

  public reset(id?: string): void {
    this.id = id
    this.answerStartedAt = undefined
    this.answerGeneration = undefined
    this.reasoning.clear()
    this.reasoningSummary = ''
    this.progressMessages.clear()
    this.planSteps.clear()
    this.inferenceSteps.clear()
    this.planTransitions.length = 0
    this.toolCalls.clear()
    this.inferences.clear()
  }

  /**
   * Records progress and returns the same timestamped activity for live hosts.
   */
  public record(event: AgentRunProgressEvent): AgentRunProgressEvent {
    if (event.type === 'inference_activity') {
      // Capture once: a completion can arrive after another step has started.
      if (!this.inferenceSteps.has(event.activity.id)) {
        this.inferenceSteps.set(event.activity.id, this.getActiveStepId())
      }
      return { ...event, activity: { ...event.activity,
        planStepId: this.inferenceSteps.get(event.activity.id)! } }
    }
    if (event.type === 'progress_message') {
      const previous = this.progressMessages.get(event.message.id)
      const message = { ...event.message,
        createdAt: previous?.createdAt ?? event.message.createdAt,
        planStepId: previous ? previous.planStepId! : this.getActiveStepId() }
      this.progressMessages.set(message.id, message)
      return { ...event, message }
    }
    if (event.type === 'reasoning_summary') {
      this.reasoningSummary = event.summary
      return event
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
      return event
    }

    const existingToolCall = this.toolCalls.get(event.toolCall.id)
    const toolCall = {
      ...existingToolCall,
      ...event.toolCall
    }
    const explicitStep = toolCall.stepLabel
      ? [...this.planSteps.values()].find((step) => step.label === toolCall.stepLabel)?.id : undefined
    toolCall.planStepId = explicitStep ?? (existingToolCall?.planStepId !== undefined
      ? existingToolCall.planStepId : this.getActiveStepId())

    // Argument streaming can be long; execution time starts at dispatch.
    if (toolCall.status === 'preparing') {
      toolCall.preparationStartedAt ??= Date.now()
    } else if (toolCall.status === 'running' || toolCall.preparationStartedAt === undefined) {
      toolCall.startedAt ??= Date.now()
    }

    this.toolCalls.set(event.toolCall.id, toolCall)

    // Hosts and persisted snapshots must share chronology without sharing a
    // mutable record that a consumer could change after publication.
    return { ...event, toolCall: { ...toolCall } }
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
  public recordReasoning(id: string, text: string, phase: string): NonNullable<AgentResponseTrace['reasoning']>[number] {
    const existing = this.reasoning.get(id)
    const block = {
      id,
      text: (existing?.text || '') + text,
      phase,
      startedAt: existing?.startedAt ?? Date.now(),
      planStepId: existing ? existing.planStepId! : this.getActiveStepId()
    }
    this.reasoning.set(id, block)
    return { ...block }
  }

  private getActiveStepId(): string | null {
    return [...this.planSteps.values()].find((step) => step.status === 'in_progress')?.id ?? null
  }

  /**
   * Tracks the current answer stream, discarding provisional or retried text.
   */
  public recordAnswer(generationId: string, token: string, reset = false): void {
    if (this.answerGeneration !== generationId || reset) {
      this.answerGeneration = generationId
      this.answerStartedAt = undefined
    }
    if (token) {
      this.answerStartedAt ??= Date.now()
    }
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
    const timings = getTurnTimings().map((timing) => this.inferenceSteps.has(timing.id)
      ? { ...timing, planStepId: this.inferenceSteps.get(timing.id)! } : timing)
    return {
      ...(this.answerStartedAt !== undefined ? { answerStartedAt: this.answerStartedAt } : {}),
      ...(timings.length ? { timings } : {}),
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
