import { FeedTurnStatus } from './feed'
import type { FeedEntry, FeedToolCall, LeonFeedActivity, LeonFeedEntry, FeedModelProcessingActivity, FeedPlanActivity, FeedPlanStep } from './feed'
import type { ConversationMetrics, ConversationRecord, ConversationTool, ConversationTrace } from './conversation'
import { TurnPhase } from '../../../../server/src/core/llm-manager/turn-timing-contract'
import { getProcessingCategory } from './processing-categories'
import { getActivityLabel, getProcessingLabel } from './activity-labels'

const entryCache = new WeakMap<ConversationRecord, { active: boolean, entry: FeedEntry }>()
const MINIMUM_PROCESSING_DURATION_MS = 1_000
const LEGACY_PLAN_WIDGET = 'PlanWidget'

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
  for (const call of trace.toolCalls) {
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
      (call.status === 'preparing' || call.status === 'running') &&
      (!currentInference || (call.preparationStartedAt ?? call.startedAt ?? sentAt) >= currentInference.startedAt)
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

  return trace.planSteps.length ? attachPlanActivities(trace, activities, processing, active, sentAt) : activities
}

/**
 * Replays step ownership at the activity's start, not at completion. Contiguous
 * plan work shares one disclosure; interruptions create a later continuation
 * instead of inserting new work above unrelated activity. Legacy traces without
 * transitions retain explicit tool assignments without guessing other ownership.
 */
function attachPlanActivities(
  trace: ConversationTrace,
  activities: LeonFeedActivity[],
  processing: FeedModelProcessingActivity | undefined,
  active: boolean,
  sentAt: number
): LeonFeedActivity[] {
  const transitions = [...(trace.planTransitions ?? [])].sort((left, right) => left.changedAt - right.changedAt)
  const planComplete = trace.planSteps.every((step) => step.status === 'completed')
  const planStart = transitions.find((transition) => transition.status === 'in_progress')?.changedAt
  const planEnd = transitions.findLast((transition) => transition.status === 'completed')?.changedAt
  const hasRecordedCompletion = planComplete && trace.planSteps.every((step) =>
    transitions.some((transition) => transition.id === step.id && transition.status === 'completed'))
  // Plan time is elapsed execution, not a sum of overlapping child requests.
  const planDuration = hasRecordedCompletion && planStart !== undefined && planEnd !== undefined && planEnd >= planStart
    ? planEnd - planStart : undefined
  const ownership: { startedAt: number, stepId: string | undefined }[] = []
  let currentStep: string | undefined
  for (const transition of transitions) {
    const next = transition.status === 'in_progress' ? transition.id
      : transition.id === currentStep ? undefined : currentStep
    if (next !== currentStep) {
      currentStep = next
      ownership.push({ startedAt: transition.changedAt, stepId: currentStep })
    }
  }
  const ownerAt = (timestamp: number | undefined): string | undefined => timestamp === undefined
    ? undefined : ownership.findLast((entry) => entry.startedAt <= timestamp)?.stepId
  const tools = new Map(trace.toolCalls.map((call) => [call.id, call]))
  const steps = new Map<string, FeedPlanStep>(trace.planSteps.map((step) => [step.id, {
    ...step, toolCalls: [],
    status: !active && (step.status === 'pending' || step.status === 'in_progress') ? 'error' : step.status,
    startedAt: transitions.find((transition) => transition.id === step.id && transition.status === 'in_progress')?.changedAt
  }]))
  const timeline: { activity?: LeonFeedActivity, stepId?: string | undefined, timestamp: number }[] = []
  const summaries: LeonFeedActivity[] = []

  for (const step of steps.values()) {
    if (step.startedAt !== undefined || step.status !== 'pending') {
      const firstTool = trace.toolCalls.find((call) => call.planStepId === step.id || call.stepLabel === step.label)
      const hasOwnedWork = Boolean(firstTool) || activities.some((activity) => activity.planStepId === step.id) ||
        processing?.requests?.some((request) => request.planStepId === step.id)
      if (step.startedAt === undefined && hasOwnedWork) {
        continue
      }
      timeline.push({ stepId: step.id, timestamp: step.startedAt ??
        firstTool?.preparationStartedAt ?? firstTool?.startedAt ?? sentAt })
    }
  }

  for (const activity of activities) {
    if (activity.type === 'processing') {
      if (!processing) {
        summaries.push(activity)
      }
      continue
    }
    if (activity.type === 'working') {
      continue
    }
    if (activity.startedAt === undefined && (activity.type === 'review' || activity.type === 'answer' ||
      activity.type === 'retry' || activity.type === 'other')) {
      summaries.push(activity)
      continue
    }
    const tool = activity.type === 'tools' ? tools.get(activity.toolCalls[0]!.id) : undefined
    const explicitStep = tool?.stepLabel
      ? trace.planSteps.find((step) => step.label === tool.stepLabel)?.id : undefined
    timeline.push({ activity, timestamp: activity.startedAt ?? sentAt,
      stepId: explicitStep ?? (tool?.planStepId !== undefined ? tool.planStepId ?? undefined
        : activity.planStepId !== undefined ? activity.planStepId ?? undefined : ownerAt(activity.startedAt)) })
  }

  const unownedRequests: NonNullable<FeedModelProcessingActivity['requests']> = []
  const currentRequest = processing?.requests?.findLast((request) => request.isActive)
  const visibleWork = active && activities.some((activity) =>
    activity.type === 'thinking' && activity.isActive ||
    activity.type === 'tools' && activity.toolCalls.some((call) =>
      (call.status === 'preparing' || call.status === 'running') &&
      (!currentRequest || (call.preparationStartedAt ?? call.startedAt ?? sentAt) >= (currentRequest.startedAt ?? sentAt)))
  )
  for (const request of processing?.requests ?? []) {
    const stepId = request.planStepId !== undefined ? request.planStepId ?? undefined : ownerAt(request.startedAt)
    if (!stepId) {
      unownedRequests.push(request)
      continue
    }
    if (request.isActive && visibleWork) {
      continue
    }
    timeline.push({ stepId, timestamp: request.startedAt ?? sentAt, activity: {
      id: request.id, type: 'processing', inline: true, durationMs: request.durationMs,
      isActive: Boolean(request.isActive), startedAt: request.startedAt, requests: [request]
    } })
  }

  timeline.sort((left, right) => left.timestamp - right.timestamp)
  const result: LeonFeedActivity[] = []
  for (const item of timeline) {
    const step = item.stepId ? steps.get(item.stepId) : undefined
    if (!step) {
      if (item.activity) {
        result.push(item.activity)
      }
      continue
    }

    const previous = result.at(-1)
    let group: FeedPlanActivity
    if (previous?.type === 'plan') {
      group = previous
    } else {
      group = { id: `${trace.id}:plan:${step.id}:${item.activity?.id ?? 'start'}`,
        type: 'plan', steps: [], startedAt: step.startedAt,
        complete: planComplete, durationMs: planDuration }
      result.push(group)
    }
    let segment = group.steps.at(-1)
    if (segment?.id !== step.id) {
      segment = { ...step, toolCalls: [], activities: [] }
      group.steps.push(segment)
    }
    if (item.activity) {
      const previousActivity = segment.activities!.at(-1)
      if (item.activity.type === 'tools' && previousActivity?.type === 'tools') {
        previousActivity.toolCalls.push(...item.activity.toolCalls)
      } else {
        segment.activities!.push(item.activity)
      }
    }
  }

  if (!result.length && steps.size) {
    result.push({ id: `${trace.id}:plan`, type: 'plan', steps: [...steps.values()] })
  }
  result.push(...summaries)
  // Turn-level accounting remains last; step requests already live at their
  // original position and must not be counted or displayed a second time.
  if (unownedRequests.length && (!active || !visibleWork && unownedRequests.some((request) => request.isActive))) {
    result.push({ ...processing!, requests: unownedRequests,
      isActive: unownedRequests.some((request) => request.isActive), durationMs: getProcessingDuration(unownedRequests) })
  } else if (active && !processing?.requests?.some((request) => request.isActive)) {
    const waiting = activities.find((activity) => activity.type === 'working')
    if (waiting) {
      const plan = result.at(-1)
      const step = plan?.type === 'plan' ? plan.steps.at(-1) : undefined
      if (step?.status === 'in_progress') {
        step.activities!.push(waiting)
      } else {
        result.push(waiting)
      }
    }
  }

  return result
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

/**
 * Locates work by its start, so late output updates keep their original call
 * above an interruption. Undated summaries belong to the final continuation.
 */
function getSegmentIndex(timestamp: number | undefined, owners: readonly ConversationRecord[]): number {
  if (timestamp === undefined) {
    return owners.length - 1
  }
  for (let index = owners.length - 1; index > 0; index--) {
    if (timestamp >= owners[index]!.sentAt) {
      return index
    }
  }

  return 0
}

/**
 * Splits display groups at owner-message boundaries without copying execution
 * state or changing plan ownership. Only the final plan segment shows its total.
 */
function splitActivities(activities: readonly LeonFeedActivity[], owners: readonly ConversationRecord[]): LeonFeedActivity[][] {
  const segments: LeonFeedActivity[][] = owners.map(() => [])
  for (const activity of activities) {
    if (activity.type === 'plan') {
      const steps: FeedPlanStep[][] = owners.map(() => [])
      for (const step of activity.steps) {
        const children = splitActivities(step.activities ?? (step.toolCalls.length ? [{
          id: step.toolCalls[0]!.id, type: 'tools', toolCalls: step.toolCalls
        }] : []), owners)
        const start = getSegmentIndex(step.startedAt, owners)
        for (const [index, items] of children.entries()) {
          if (items.length || index === start) {
            steps[index]!.push({ ...step, activities: items,
              toolCalls: step.toolCalls.filter((call) => getSegmentIndex(call.preparationStartedAt ?? call.startedAt, owners) === index) })
          }
        }
      }
      const last = steps.findLastIndex((items) => items.length > 0)
      for (const [index, items] of steps.entries()) {
        if (items.length) {
          segments[index]!.push({ ...activity, id: `${activity.id}:${owners[index]!.messageId}`,
            steps: items, durationMs: index === last ? activity.durationMs : undefined })
        }
      }
    } else if (activity.type === 'tools') {
      const calls: FeedToolCall[][] = owners.map(() => [])
      for (const call of activity.toolCalls) {
        calls[getSegmentIndex(call.preparationStartedAt ?? call.startedAt, owners)]!.push(call)
      }
      for (const [index, items] of calls.entries()) {
        if (items.length) {
          segments[index]!.push({ ...activity, id: items[0]!.id, toolCalls: items })
        }
      }
    } else if (activity.type === 'processing' && activity.requests?.length) {
      const requests: NonNullable<FeedModelProcessingActivity['requests']>[] = owners.map(() => [])
      // Live processing has one inline status, not a completed-history group.
      for (const request of activity.requests.filter((request) => !activity.isActive || request.isActive)) {
        requests[getSegmentIndex(request.startedAt, owners)]!.push(request)
      }
      for (const [index, items] of requests.entries()) {
        if (items.length) {
          segments[index]!.push({ ...activity, requests: items, durationMs: getProcessingDuration(items),
            isActive: items.some((request) => request.isActive) })
        }
      }
    } else {
      const index = activity.type === 'working' ? owners.length - 1 : getSegmentIndex(activity.startedAt, owners)
      segments[index]!.push(activity)
    }
  }

  return segments
}

/**
 * Keeps a consumed follow-up in the same response while presenting new work
 * below it. Durable timestamps rebuild identical boundaries after replay.
 */
function splitResponse(entry: LeonFeedEntry, owners: readonly ConversationRecord[]): LeonFeedEntry[] {
  return splitActivities(entry.activities, owners).map((activities, index) => {
    const last = index === owners.length - 1
    if (last && entry.status === FeedTurnStatus.InProgress && !activities.length && !entry.finalAnswer.trim()) {
      activities.push({ id: `${entry.id}:processing`, type: 'working', label: getActivityLabel(`${entry.id}:waiting`) })
    }

    return { ...entry, id: index === 0 ? entry.id : `${entry.id}:after:${owners[index]!.messageId}`,
      responseId: entry.id, continues: !last, hasTurnWork: entry.activities.length > 0, activities,
      finalAnswer: last ? entry.finalAnswer : '',
      ...(last ? {} : { artifacts: [], bonusResponse: '' }) }
  })
}

/**
 * Keeps legacy-only plans visible while suppressing their duplicate widget
 * fallback when the same turn already contains a structured execution plan.
 * Stored records and other widget messages remain untouched.
 */
export function toFeedEntries(records: readonly ConversationRecord[], running: boolean): FeedEntry[] {
  const owners = records.filter((record) => record.who === 'owner')
  // Browser responses use the same command-derived ID as optimistic delivery.
  // Historical non-browser IDs retain their original adjacent-message grouping.
  const responseOwners = new Map(owners.map((owner, index) => [`${owner.messageId}:leon`, index]))
  const responses = new Set(records.filter((record) => record.who === 'leon').map((record) => record.messageId))
  const groups = new Map(owners.map((owner) => [owner.messageId, [toFeedEntry(owner, running)]]))
  const structuredPlanTurns = new Set<string | undefined>()
  let turnId: string | undefined
  for (const record of records) {
    if (record.who === 'owner') {
      turnId = record.messageId
    } else if (record.agentResponseTrace?.planSteps.length) {
      structuredPlanTurns.add(turnId)
    }
  }

  turnId = undefined
  const entries: FeedEntry[] = []
  for (const record of records) {
    if (record.who === 'owner') {
      turnId = record.messageId
      continue
    } else if (!record.isAddedToHistory && record.widget?.widget === LEGACY_PLAN_WIDGET && structuredPlanTurns.has(turnId)) {
      continue
    }
    const entry = toFeedEntry(record, running)
    const ownerIndex = responseOwners.get(record.messageId)
    const end = running && !record.isAddedToHistory ? Infinity : record.sentAt
    const turnOwners: ConversationRecord[] = []
    if (ownerIndex !== undefined) {
      for (let index = ownerIndex; index < owners.length; index++) {
        const owner = owners[index]!
        // A separately dispatched response ends the preceding turn's scope,
        // including when adjacent messages share millisecond clock values.
        if (owner.sentAt > end || turnOwners.length && responses.has(`${owner.messageId}:leon`)) {
          break
        }
        turnOwners.push(owner)
      }
    }
    if (entry.role === 'leon' && turnOwners.length > 1) {
      for (const [index, segment] of splitResponse(entry, turnOwners).entries()) {
        if (segment.activities.length || segment.finalAnswer || segment.artifacts?.length) {
          groups.get(turnOwners[index]!.messageId)!.push(segment)
        }
      }
    } else {
      const group = groups.get(ownerIndex === undefined ? turnId ?? '' : owners[ownerIndex]!.messageId)
      ;(group ?? entries).push(entry)
    }
  }

  return [...entries, ...groups.values()].flat()
}
