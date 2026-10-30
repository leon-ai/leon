import { FeedTurnStatus } from './feed'
import type { FeedEntry, FeedToolCall, LeonFeedActivity } from './feed'
import type { ConversationRecord, ConversationTool, ConversationTrace } from './conversation'

const entryCache = new WeakMap<ConversationRecord, { active: boolean, entry: FeedEntry }>()
/**
 * Maps persisted and streamed calls through the same display contract.
 */
export function toFeedTool(call: ConversationTool, active = true): FeedToolCall {
  const parts = call.name.split('.')

  return {
    id: call.id,
    toolCallTitle: call.toolCallTitle ?? call.name,
    toolkitName: call.toolkitName ?? parts[0] ?? '',
    toolName: call.toolName ?? parts[1] ?? '',
    functionName: parts.at(-1) ?? call.name,
    toolIconName: call.toolIconName ?? 'tools-line',
    status: !active && (call.status === 'running' || call.status === 'preparing') ? 'error' : call.status,
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
  isAnswering: boolean
): LeonFeedActivity[] {
  const items: { timestamp: number, activity: LeonFeedActivity }[] = []
  for (const [index, block] of (trace.reasoning ?? []).entries()) {
    const nextAt = trace.reasoning?.[index + 1]?.startedAt ??
      trace.toolCalls.find((call) => (call.startedAt ?? 0) > block.startedAt)?.startedAt
    const inference = trace.inferences?.findLast((attempt) => attempt.phase === block.phase && attempt.startedAt <= block.startedAt)
    items.push({ timestamp: block.startedAt, activity: {
      id: block.id, type: 'thinking', details: block.text ? [block.text] : [],
      durationMs: inference?.elapsedMs ?? Math.max(0, (nextAt ?? block.startedAt) - block.startedAt), isActive: false
    } })
  }
  for (const message of trace.progressMessages ?? []) {
    items.push({ timestamp: message.createdAt, activity: {
      id: message.id, type: 'summary', content: message.content
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
      id: call.id, type: 'tools', toolCalls: [toFeedTool(call, active)]
    } })
  }
  items.sort((left, right) => left.timestamp - right.timestamp)
  const activities: LeonFeedActivity[] = []
  for (const { activity } of items) {
    const previous = activities.at(-1)
    if (activity.type === 'tools' && previous?.type === 'tools') {
      previous.toolCalls.push(...activity.toolCalls)
    } else {
      activities.push(activity)
    }
  }
  const last = activities.at(-1)
  if (active && last?.type === 'thinking') {
    last.isActive = !isAnswering
  } else if (active && !isAnswering && activities.length === 0) {
    // Waiting for provider output is not evidence of reasoning being streamed.
    activities.push({ id: `${trace.id}:waiting`, type: 'working' })
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
    id: record.messageId, role: 'owner', content: record.message
  } : {
    id: record.messageId,
    role: 'leon',
    status: active ? FeedTurnStatus.InProgress : FeedTurnStatus.Completed,
    ...(record.draftGeneration ? { answerGenerationId: record.draftGeneration } : {}),
    durationMs: metrics.durationMs ?? 0,
    activities: toActivities(record.agentResponseTrace ?? {
      id: record.messageId, planSteps: [], toolCalls: []
    }, active, record.sentAt, Boolean(record.message.trim())),
    finalAnswer: record.message,
    ...(record.artifacts ? { artifacts: record.artifacts } : {})
  }
  entryCache.set(record, { active, entry })

  return entry
}
