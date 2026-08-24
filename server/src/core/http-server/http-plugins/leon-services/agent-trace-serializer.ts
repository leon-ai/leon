import type { AgentResponseTrace } from '@/types'

import type { HTTPPluginAgentTrace } from '../types'

/** Converts persisted trace fields to the HTTP plugin schema. */
export function serializeAgentTrace(
  trace: AgentResponseTrace,
  includeDeveloperProvenance: boolean
): HTTPPluginAgentTrace {
  return {
    ...(trace.reasoningSummary
      ? { reasoning_summary: trace.reasoningSummary }
      : {}),
    plan_steps: trace.planSteps.map((step) => ({ ...step })),
    tool_calls: trace.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      status: toolCall.status,
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

/** Converts an HTTP plugin trace to Leon's persisted conversation schema. */
export function deserializeAgentTrace(
  trace: HTTPPluginAgentTrace
): AgentResponseTrace {
  return {
    reasoningSummary: trace.reasoning_summary || '',
    planSteps: trace.plan_steps.map((step) => ({ ...step })),
    toolCalls: trace.tool_calls.map((toolCall) => ({
      id: toolCall.id || toolCall.name,
      name: toolCall.name,
      status: toolCall.status,
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
