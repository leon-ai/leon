import type { AgentResponseTrace } from '@/types'

import type { HTTPPluginAgentTrace } from '../types'

/**
 * Converts persisted trace fields to the HTTP plugin schema.
 */
export function serializeAgentTrace(
  trace: AgentResponseTrace,
  includeDeveloperProvenance: boolean
): HTTPPluginAgentTrace {
  return {
    ...(trace.inferences
      ? { inferences: trace.inferences.map((timing) => ({ ...timing })) }
      : {}),
    ...(trace.progressMessages
      ? {
          progress_messages: trace.progressMessages.map((message) => ({
            id: message.id,
            content: message.content,
            created_at: message.createdAt
          }))
        }
      : {}),
    ...(trace.reasoningSummary
      ? { reasoning_summary: trace.reasoningSummary }
      : {}),
    plan_steps: trace.planSteps.map((step) => ({ ...step })),
    ...(trace.planTransitions
      ? {
          plan_transitions: trace.planTransitions.map((transition) => ({
            id: transition.id,
            label: transition.label,
            status: transition.status,
            changed_at: transition.changedAt
          }))
        }
      : {}),
    tool_calls: trace.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      ...(toolCall.toolkitName ? { toolkit_name: toolCall.toolkitName } : {}),
      ...(toolCall.toolName ? { tool_name: toolCall.toolName } : {}),
      ...(toolCall.toolCallTitle
        ? { tool_call_title: toolCall.toolCallTitle }
        : {}),
      status: toolCall.status,
      ...(toolCall.preparationStartedAt !== undefined
        ? { preparation_started_at: toolCall.preparationStartedAt }
        : {}),
      ...(toolCall.startedAt !== undefined ? { started_at: toolCall.startedAt } : {}),
      ...(toolCall.durationMs !== undefined ? { duration_ms: toolCall.durationMs } : {}),
      ...(toolCall.toolkitIconName
        ? { toolkit_icon_name: toolCall.toolkitIconName }
        : {}),
      ...(toolCall.toolIconName
        ? { tool_icon_name: toolCall.toolIconName }
        : {}),
      ...(toolCall.input !== undefined ? { input: toolCall.input } : {}),
      ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
      ...(toolCall.stepLabel ? { step_label: toolCall.stepLabel } : {}),
      ...(toolCall.errorMessage
        ? { error_message: toolCall.errorMessage }
        : {}),
      ...(toolCall.skillId ? { skill_id: toolCall.skillId } : {}),
      ...(includeDeveloperProvenance && toolCall.nativeSkillPath
        ? { native_skill_path: toolCall.nativeSkillPath }
        : {})
    })),
    ...(trace.metrics ? { metrics: trace.metrics } : {})
  }
}

/**
 * Converts an HTTP plugin trace to Leon's persisted conversation schema.
 */
export function deserializeAgentTrace(
  trace: HTTPPluginAgentTrace
): AgentResponseTrace {
  return {
    ...(trace.inferences
      ? { inferences: trace.inferences.map((timing) => ({ ...timing })) }
      : {}),
    ...(trace.progress_messages
      ? {
          progressMessages: trace.progress_messages.map((message) => ({
            id: message.id,
            content: message.content,
            createdAt: message.created_at
          }))
        }
      : {}),
    reasoningSummary: trace.reasoning_summary || '',
    planSteps: trace.plan_steps.map((step) => ({ ...step })),
    ...(trace.plan_transitions
      ? {
          planTransitions: trace.plan_transitions.map((transition) => ({
            id: transition.id,
            label: transition.label,
            status: transition.status,
            changedAt: transition.changed_at
          }))
        }
      : {}),
    toolCalls: trace.tool_calls.map((toolCall) => ({
      id: toolCall.id || toolCall.name,
      name: toolCall.name,
      ...(toolCall.toolkit_name ? { toolkitName: toolCall.toolkit_name } : {}),
      ...(toolCall.tool_name ? { toolName: toolCall.tool_name } : {}),
      ...(toolCall.tool_call_title
        ? { toolCallTitle: toolCall.tool_call_title }
        : {}),
      status: toolCall.status,
      ...(toolCall.preparation_started_at !== undefined
        ? { preparationStartedAt: toolCall.preparation_started_at }
        : {}),
      ...(toolCall.started_at !== undefined ? { startedAt: toolCall.started_at } : {}),
      ...(toolCall.duration_ms !== undefined ? { durationMs: toolCall.duration_ms } : {}),
      ...(toolCall.toolkit_icon_name
        ? { toolkitIconName: toolCall.toolkit_icon_name }
        : {}),
      ...(toolCall.tool_icon_name
        ? { toolIconName: toolCall.tool_icon_name }
        : {}),
      ...(toolCall.input !== undefined ? { input: toolCall.input } : {}),
      ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
      ...(toolCall.step_label ? { stepLabel: toolCall.step_label } : {}),
      ...(toolCall.error_message
        ? { errorMessage: toolCall.error_message }
        : {}),
      ...(toolCall.skill_id ? { skillId: toolCall.skill_id } : {}),
      ...(toolCall.native_skill_path
        ? { nativeSkillPath: toolCall.native_skill_path }
        : {})
    })),
    ...(trace.metrics ? { metrics: trace.metrics } : {})
  }
}
