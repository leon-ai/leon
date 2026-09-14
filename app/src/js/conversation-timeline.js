/**
 * Expand durable traces into the same chronological feed as live activity.
 */
export function expandConversationTimeline(messages) {
  const activities = new Map()
  const timeline = []

  for (const message of messages) {
    const trace = message.who === 'leon' ? message.agentResponseTrace : null
    if (trace) {
      for (const reasoning of trace.reasoning || []) {
        activities.set(`reasoning:${reasoning.id}`, {
          who: 'leon',
          sentAt: reasoning.startedAt ?? message.sentAt,
          reasoning
        })
      }
      for (const toolCall of trace.toolCalls || []) {
        activities.set(`tool:${trace.id || ''}:${toolCall.id}`, {
          who: 'leon',
          sentAt: toolCall.startedAt ?? message.sentAt,
          toolCall
        })
      }
    }

    // In-progress turns carry a trace without an empty assistant bubble.
    if (message.originalString || message.string) {
      timeline.push(message)
    }
  }

  // Older traces have no activity timestamps: place them before their answer.
  return [...activities.values(), ...timeline]
}
