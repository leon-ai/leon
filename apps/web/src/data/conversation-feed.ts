import { FeedTurnStatus } from './feed'
import type { FeedEntry, FeedToolCall, LeonFeedActivity, FeedModelProcessingActivity } from './feed'
import type { ConversationMetrics, ConversationRecord, ConversationTool, ConversationTrace } from './conversation'
import { TurnPhase } from '../../../../server/src/core/llm-manager/turn-timing-contract'
import { getProcessingCategory } from './processing-categories'
import { getActivityLabel, getProcessingLabel } from './activity-labels'

const entryCache = new WeakMap<ConversationRecord, { active: boolean, entry: FeedEntry }>()
const MINIMUM_PROCESSING_DURATION_MS = 1_000

/**
 * Measures coverage of start-sorted requests, excluding overlap and idle gaps.
 */
function getProcessingDuration(requests: readonly { startedAt?: number | undefined, durationMs: number }[]): number {
  let coveredUntil = -Infinity
  let durationMs = 0
  for (const request of requests) {
    if (request.startedAt === undefined) {
      continue
    }
    const end = request.startedAt + request.durationMs
    durationMs += Math.max(0, end - Math.max(coveredUntil, request.startedAt))
    coveredUntil = Math.max(coveredUntil, end)
  }
  return durationMs
}

/**
 * Uses recorded request goals, with a neutral duty label for older unclassified
 * traces. Provider time is interval coverage, never gaps between requests.
 */
function toProcessingActivity(trace: ConversationTrace, active: boolean): FeedModelProcessingActivity | undefined {
  const recorded = trace.timings?.filter((timing) => timing.kind === 'inference' && (active || timing.outcome !== 'started'))
  const timings = recorded?.length ? recorded : (trace.inferences ?? [])
    .filter((attempt) => active || attempt.outcome !== 'started').map((attempt, index) => ({
    id: attempt.attemptId ?? `${trace.id}:inference:${index}`,
    goal: attempt.usagePurpose ?? (attempt.phase === 'review' ? TurnPhase.Review
      : attempt.phase === 'final_answer' ? TurnPhase.Answer : attempt.duty ?? TurnPhase.Request),
    startedAt: attempt.startedAt, durationMs: attempt.elapsedMs, outcome: attempt.outcome ?? 'completed',
    planStepId: undefined
  }))
  const valid = timings.filter((timing) => Number.isFinite(timing.startedAt) && Number.isFinite(timing.durationMs) && timing.durationMs >= 0)
    .sort((left, right) => left.startedAt - right.startedAt)
  if (!valid.length) {
    return undefined
  }
  const requests = valid.map((timing) => {
    return {
      id: timing.id,
      ...getProcessingCategory(timing.goal),
      durationMs: timing.durationMs,
      startedAt: timing.startedAt,
      planStepId: timing.planStepId,
      isActive: active && timing.outcome === 'started',
      activeLabel: getProcessingLabel(timing.goal, timing.id)
    }
  })
  return {
    id: `${trace.id}:processing`, type: 'processing', durationMs: getProcessingDuration(valid), requests,
    startedAt: valid[0]?.startedAt,
    isActive: requests.some((request) => request.isActive)
  }
}

/**
 * Counts explicit retry transitions, not ordinary model requests. An additional
 * attempt must exist so cancellation during a retry delay is not counted.
 */
function getRetryCount(trace: ConversationTrace, metrics: ConversationMetrics): number {
  const attempts = trace.inferences ?? []
  let providerRetries = 0
  let reviewProviderRetries = 0

  for (const [index, attempt] of attempts.entries()) {
    if (attempt.retryDecision !== 'retry' || attempts[index + 1]?.phase !== attempt.phase) {
      continue
    }

    if (attempt.phase === 'review') {
      reviewProviderRetries++
    } else {
      providerRetries++
    }
  }

  // Review metrics also include invalid-response retries. Their provider
  // retries are already included, so these counts must not be added together.
  const reviewRetries = metrics.reviewRetryCount
  const recordedReviewRetries = reviewRetries !== undefined && Number.isSafeInteger(reviewRetries) && reviewRetries >= 0
    ? reviewRetries : 0

  return providerRetries + Math.max(recordedReviewRetries, reviewProviderRetries)
}

/**
 * Maps persisted and streamed calls through the same display contract.
 */
export function toFeedTool(call: ConversationTool, active = true): FeedToolCall {
  const parts = call.name.split('.')
  const title = call.toolCallTitle?.trim()

  return {
    id: call.id,
    toolCallTitle: title && title !== call.name ? title : '',
    toolkitName: call.toolkitName ?? parts[0] ?? '',
    toolName: call.toolName ?? parts[1] ?? '',
    functionName: parts.at(-1) ?? call.name,
    toolIconName: call.toolIconName ?? 'tools-line',
    status: !active && (call.status === 'running' || call.status === 'preparing') ? 'error' : call.status,
    startedAt: call.startedAt,
    preparationStartedAt: call.preparationStartedAt,
    ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
    input: call.input ?? null,
    ...(call.output === undefined && call.commandOutput === undefined && call.errorMessage === undefined
      ? {} : { output: call.output ?? call.commandOutput ?? call.errorMessage ?? null })
  }
}

/**
 * Keeps later thinking separate from earlier tool/plan activity, never exposing
 * private review reasoning (which is absent from the public trace).
 */
function toActivities(
  trace: ConversationTrace,
  active: boolean,
  sentAt: number,
  metrics: ConversationMetrics,
  isAnswering: boolean
): LeonFeedActivity[] {
  const processing = toProcessingActivity(trace, active)
  const currentInference = active ? trace.timings?.findLast((timing) => timing.kind === 'inference' && timing.outcome === 'started') : undefined
  const items: { timestamp: number, activity: LeonFeedActivity }[] = []
  for (const [index, block] of (trace.reasoning ?? []).entries()) {
    const nextAt = trace.reasoning?.[index + 1]?.startedAt ??
      trace.toolCalls.find((call) => (call.startedAt ?? 0) > block.startedAt)?.startedAt
    const inference = trace.inferences?.findLast((attempt) => attempt.phase === block.phase && attempt.startedAt <= block.startedAt)
    const timing = trace.timings?.findLast((entry) => entry.kind === 'inference' && entry.startedAt <= block.startedAt)
    // Tool preparation can end visible thinking before its request completes.
    // Wait for measured timing instead of presenting an unknown duration as zero.
    let durationMs: number | undefined
    if (timing) {
      if (timing.outcome !== 'started') {
        durationMs = timing.durationMs
      }
    } else if (inference) {
      if (inference.outcome !== 'started') {
        durationMs = inference.elapsedMs
      }
    } else if (nextAt !== undefined) {
      durationMs = Math.max(0, nextAt - block.startedAt)
    }

    items.push({ timestamp: block.startedAt, activity: {
      id: block.id, type: 'thinking', details: block.text ? [block.text] : [],
      startedAt: block.startedAt,
      planStepId: block.planStepId,
      durationMs, isActive: false
    } })
  }
  for (const message of trace.progressMessages ?? []) {
    items.push({ timestamp: message.createdAt, activity: {
      id: message.id, type: 'summary', content: message.content, startedAt: message.createdAt,
      planStepId: message.planStepId
    } })
  }
  if (trace.planSteps.length > 0) {
    const planAt = trace.planTransitions?.[0]?.changedAt ??
      trace.toolCalls.find((call) => call.stepLabel)?.startedAt ?? sentAt
    items.push({ timestamp: planAt, activity: {
      id: `${trace.id}:plan`, type: 'plan', steps: trace.planSteps.map((step) => ({
        ...step,
        status: !active && (step.status === 'pending' || step.status === 'in_progress') ? 'error' : step.status,
        toolCalls: trace.toolCalls.filter((call) => call.stepLabel === step.label).map((call) => toFeedTool(call, active))
      }))
    } })
  }
  for (const call of trace.toolCalls) {
    if (call.stepLabel && trace.planSteps.some((step) => step.label === call.stepLabel)) {
      continue
    }
    items.push({ timestamp: call.preparationStartedAt ?? call.startedAt ?? sentAt, activity: {
      id: call.id, type: 'tools', toolCalls: [toFeedTool(call, active)],
      startedAt: call.preparationStartedAt ?? call.startedAt
    } })
  }
  items.sort((left, right) => left.timestamp - right.timestamp)
  const activities: LeonFeedActivity[] = []
  for (const { activity } of items) {
    const previous = activities.at(-1)
    if (!trace.planSteps.length && activity.type === 'tools' && previous?.type === 'tools') {
      previous.toolCalls.push(...activity.toolCalls)
    } else {
      activities.push(activity)
    }
  }
  const last = activities.at(-1)
  if (active && last?.type === 'thinking') {
    // A later request (especially a private review) is not a continuation of
    // the previous visible reasoning block.
    last.isActive = !isAnswering && (!trace.timings?.length || Boolean(currentInference &&
      (trace.reasoning?.at(-1)?.startedAt ?? 0) >= currentInference.startedAt))
  }

  const hasVisibleWork = active && activities.some((activity) =>
    activity.type === 'thinking' && activity.isActive ||
    activity.type === 'tools' && activity.toolCalls.some((call) =>
      call.status === 'preparing' || call.status === 'running'
    )
  )

  // Legacy metrics remain completed summaries; live requests use timing events
  // and never expose private review text.
  if (!active) {
    const processingDuration = metrics.modelProcessingDurationMs
    const legacyProcessing = (
      !processing && processingDuration !== undefined && Number.isFinite(processingDuration) &&
      processingDuration >= MINIMUM_PROCESSING_DURATION_MS && processingDuration <= (metrics.durationMs ?? 0)
    ) ? { id: `${trace.id}:processing`, type: 'processing' as const, durationMs: processingDuration } : undefined

    const answerDuration = metrics.phaseMetrics?.final_answer?.durationMs
    if (!processing && answerDuration !== undefined && Number.isFinite(answerDuration) && answerDuration > 0) {
      activities.push({ id: `${trace.id}:answer`, type: 'answer', durationMs: answerDuration })
    }

    const reviewDuration = metrics.reviewDurationMs
    if (
      !processing && (metrics.reviewCount ?? 0) > 0 && reviewDuration !== undefined &&
      Number.isFinite(reviewDuration) && reviewDuration >= 0
    ) {
      activities.push({ id: `${trace.id}:review`, type: 'review', durationMs: reviewDuration })
    }

    const retryCount = getRetryCount(trace, metrics)
    if (retryCount > 0) {
      const retry = trace.inferences?.find((attempt, index, attempts) => index > 0 &&
        attempts[index - 1]?.retryDecision === 'retry' && attempts[index - 1]?.phase === attempt.phase)
      activities.push({ id: `${trace.id}:retry`, type: 'retry', count: retryCount, startedAt: retry?.startedAt })
    }

    // Historical totals without interval-based accounting must not be guessed.
    const otherDuration = metrics.otherProcessingDurationMs
    if (
      otherDuration !== undefined && Number.isFinite(otherDuration) &&
      otherDuration >= MINIMUM_PROCESSING_DURATION_MS && otherDuration <= (metrics.durationMs ?? 0)
    ) {
      activities.push({ id: `${trace.id}:other`, type: 'other', durationMs: otherDuration })
    }

    // Reasoning stays in chronology; the request accounting closes the work details.
    const finalProcessing = processing ?? legacyProcessing
    if (finalProcessing) {
      activities.push(finalProcessing)
    }
  } else if (!hasVisibleWork) {
    // Keep the same row mounted across model handoffs, but let visible thinking
    // and tool execution own their activity rather than duplicating indicators.
    if (processing?.isActive) {
      activities.push(processing)
    } else if (!isAnswering) {
      activities.push({
        id: `${trace.id}:processing`, type: 'working',
        label: getActivityLabel(`${trace.id}:waiting`)
      })
    }
  }

  return activities
}

/**
 * Reuses unchanged row objects so a token cannot rerender every historical turn.
 */
export function toFeedEntry(record: ConversationRecord, running: boolean): FeedEntry {
  const active = running && !record.isAddedToHistory
  const cached = entryCache.get(record)
  if (cached?.active === active) {
    return cached.entry
  }
  const metrics = { ...record.agentResponseTrace?.metrics, ...record.llmMetrics }
  const entry: FeedEntry = record.who === 'owner' ? {
    id: record.messageId, role: 'owner', content: record.message, sentAt: record.sentAt
  } : {
    id: record.messageId,
    role: 'leon',
    status: active ? FeedTurnStatus.InProgress : FeedTurnStatus.Completed,
    ...(record.draftGeneration ? { answerGenerationId: record.draftGeneration } : {}),
    durationMs: metrics.durationMs ?? 0,
    activities: toActivities(record.agentResponseTrace ?? {
      id: record.messageId, planSteps: [], toolCalls: []
    }, active, record.sentAt, metrics, Boolean(record.message.trim())),
    finalAnswer: record.message,
    answerStartedAt: record.agentResponseTrace?.timings?.findLast((timing) =>
      timing.kind === 'inference' && timing.goal === TurnPhase.Answer)?.startedAt ??
      record.agentResponseTrace?.inferences?.findLast((attempt) => attempt.phase === 'final_answer')?.startedAt ??
      record.agentResponseTrace?.answerStartedAt,
    ...(record.artifacts ? { artifacts: record.artifacts } : {})
  }
  entryCache.set(record, { active, entry })

  return entry
}

