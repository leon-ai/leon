import type { ConversationEvent, ConversationRecord, ConversationTrace, ConversationTool } from './conversation'
import type { InferenceActivity } from '../../../../server/src/core/llm-manager/turn-timing-contract'

/**
 * Converts the shared HTTP event schema to the persisted trace field names.
 */
export function readEventTool(value: Record<string, unknown>): ConversationTool {
  return {
    id: String(value['id'] ?? value['name']),
    name: String(value['name']),
    ...(value['plan_step_id'] !== undefined ? { planStepId: value['plan_step_id'] as string | null } : {}),
    status: value['status'] as ConversationTool['status'],
    ...(value['tool_call_title'] ? { toolCallTitle: String(value['tool_call_title']) } : {}),
    ...(value['toolkit_name'] ? { toolkitName: String(value['toolkit_name']) } : {}),
    ...(value['tool_name'] ? { toolName: String(value['tool_name']) } : {}),
    ...(value['tool_icon_name'] ? { toolIconName: String(value['tool_icon_name']) } : {}),
    ...(typeof value['started_at'] === 'number' ? { startedAt: value['started_at'] } : {}),
    ...(typeof value['preparation_started_at'] === 'number' ? { preparationStartedAt: value['preparation_started_at'] } : {}),
    ...(typeof value['duration_ms'] === 'number' ? { durationMs: value['duration_ms'] } : {}),
    ...(value['step_label'] ? { stepLabel: String(value['step_label']) } : {}),
    ...(value['input'] === undefined ? {} : { input: value['input'] as NonNullable<ConversationTool['input']> }),
    ...(value['output'] === undefined ? {} : { output: value['output'] as NonNullable<ConversationTool['output']> }),
    ...(value['command_output'] === undefined ? {} : { commandOutput: String(value['command_output']) }),
    ...(value['error_message'] ? { errorMessage: String(value['error_message']) } : {})
  }
}

/**
 * Upserts by durable response ID while preserving every untouched message object.
 */
export function applyConversationEvent(messages: ConversationRecord[], event: ConversationEvent): ConversationRecord[] {
  if (event.type === 'turn_status' && event.data['consumed'] === true) {
    return messages.filter((record) => record.messageId !== event.response_id)
  }
  if (event.type === 'owner_message') {
    const message = event.data['message'] as ConversationRecord | undefined
    if (!message) {
      return messages
    }
    const index = messages.findIndex((candidate) => candidate.messageId === message.messageId)

    const next = index < 0 ? [...messages, message] : messages.map((candidate, position) => position === index ? message : candidate)

    // The acknowledgement can have a later clock value than the optimistic
    // placeholder. Keep that draft after its owner message, not in an orphan turn.
    return next.map((candidate) => candidate.messageId === `${message.messageId}:leon` &&
      !candidate.isAddedToHistory && candidate.sentAt <= message.sentAt
      ? { ...candidate, sentAt: message.sentAt + 1 } : candidate)
  }
  const id = event.response_id
  if (!id || event.type === 'session_changed' || event.type === 'turn_status') {
    return messages
  }
  const index = messages.findIndex((record) => record.messageId === id)
  const previous = messages[index] ?? {
    who: 'leon' as const, messageId: id, message: '', sentAt: event.created_at, isAddedToHistory: false
  }
  // Accepted final content is authoritative over delayed draft and retry events.
  if (previous.isAddedToHistory && event.type !== 'final_answer' && event.type !== 'artifacts') {
    return messages
  }
  let record: ConversationRecord = { ...previous }
  const trace: ConversationTrace = {
    id, planSteps: [], toolCalls: [], ...previous.agentResponseTrace
  }
  record.agentResponseTrace = trace
  const data = event.data

  if (event.type === 'inference_activity') {
    const activity = data['activity'] as InferenceActivity
    const timing = { ...activity, kind: 'inference' as const }
    const found = trace.timings?.some((item) => item.id === timing.id)
    trace.timings = found ? trace.timings!.map((item) => item.id === timing.id ? timing : item)
      : [...(trace.timings ?? []), timing]
  } else if (event.type === 'text_stream') {
    const token = String(data['token'] ?? '')
    const generationId = String(data['generationId'])
    if (data['kind'] === 'answer') {
      if (data['reset'] || record.draftGeneration !== generationId) {
        delete trace.answerStartedAt
      }
      if (token) {
        trace.answerStartedAt ??= event.created_at
      }
      record.message = data['reset'] ? '' :
        `${record.draftGeneration === generationId ? record.message : ''}${token}`
      record.draftGeneration = generationId
    } else {
      const blocks = [...(trace.reasoning ?? [])]
      const blockIndex = blocks.findIndex((block) => block.id === generationId)
      const block = blocks[blockIndex]
      const next = {
        id: generationId, phase: String(data['phase'] ?? 'agent'),
        startedAt: block?.startedAt ?? event.created_at, text: `${block?.text ?? ''}${token}`,
        ...(data['planStepId'] !== undefined ? { planStepId: data['planStepId'] as string | null } : {})
      }
      if (blockIndex < 0) {
        blocks.push(next)
      } else {
        blocks[blockIndex] = next
      }
      trace.reasoning = blocks
    }
  } else if (event.type === 'reasoning_summary') {
    trace.reasoningSummary = String(data['summary'])
  } else if (event.type === 'progress_message') {
    const message = data['message'] as { id: string, content: string, created_at: number, plan_step_id?: string | null }
    const progress = { id: message.id, content: message.content, createdAt: message.created_at,
      ...(message.plan_step_id !== undefined ? { planStepId: message.plan_step_id } : {}) }
    trace.progressMessages = [...(trace.progressMessages ?? []).filter((item) => item.id !== progress.id), progress]
    record.message = ''
  } else if (event.type === 'plan_step') {
    const step = data['step'] as ConversationTrace['planSteps'][number]
    const found = trace.planSteps.some((item) => item.id === step.id)
    trace.planSteps = found ? trace.planSteps.map((item) => item.id === step.id ? step : item) : [...trace.planSteps, step]
    trace.planTransitions = [...(trace.planTransitions ?? []), { ...step, changedAt: event.created_at }]
  } else if (event.type === 'tool_call') {
    const call = readEventTool(data['tool_call'] as Record<string, unknown>)
    const found = trace.toolCalls.some((item) => item.id === call.id)
    trace.toolCalls = found ? trace.toolCalls.map((item) => item.id === call.id ? { ...item, ...call } : item)
      : [...trace.toolCalls, call]
  } else if (event.type === 'metrics') {
    trace.metrics = data['metrics'] as NonNullable<ConversationTrace['metrics']>
  } else if (event.type === 'final_answer') {
    // Completed traces include provider attempts that are not streamed as
    // separate events. Use them immediately instead of waiting for navigation.
    const completedTrace = data['response_trace'] as Pick<ConversationTrace, 'inferences' | 'metrics' | 'timings' | 'answerStartedAt'> | undefined
    if (completedTrace?.answerStartedAt !== undefined) {
      trace.answerStartedAt = completedTrace.answerStartedAt
    }
    if (completedTrace?.timings) {
      trace.timings = completedTrace.timings
    }
    if (completedTrace?.inferences) {
      trace.inferences = completedTrace.inferences
    }
    if (completedTrace?.metrics) {
      trace.metrics = completedTrace.metrics
    }

    record = {
      ...record, message: String(data['content'] ?? ''), isAddedToHistory: true, sentAt: event.created_at,
      artifacts: data['artifacts'] as NonNullable<ConversationRecord['artifacts']>
    }
  } else if (event.type === 'error') {
    record.message = String(data['message'] ?? 'The turn could not finish.')
    record.isAddedToHistory = true
  } else {
    return messages
  }

  return index < 0 ? [...messages, record] : messages.map((message, position) => position === index ? record : message)
}
