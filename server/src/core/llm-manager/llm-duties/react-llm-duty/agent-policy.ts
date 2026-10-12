import type { LLMDefaultReasoningSource } from '@/core/llm-manager/llm-model-catalog'
import type {
  LLMReasoningMode,
  LLMReasoningEffort,
  LLMReasoningSummary,
  LLMTextVerbosity,
  LLMServiceTier
} from '@/core/llm-manager/types'

export interface AgentInferencePolicy {
  reasoningMode: LLMReasoningMode
  reasoningEffort?: LLMReasoningEffort
  reasoningEffortSource?: LLMDefaultReasoningSource | 'owner' | 'recovery'
  serviceTier?: LLMServiceTier
  streamToProvider: boolean
  emitReasoning: boolean
  reasoningSummary?: LLMReasoningSummary
  textVerbosity?: LLMTextVerbosity
}

const AGENT_INFERENCE_POLICY: AgentInferencePolicy = {
  reasoningMode: 'on',
  streamToProvider: true,
  emitReasoning: true,
  reasoningSummary: 'auto',
  textVerbosity: 'low'
}

export function getAgentInferencePolicy(): AgentInferencePolicy {
  return AGENT_INFERENCE_POLICY
}

export function formatAgentInferencePolicyForLog(
  policy: AgentInferencePolicy
): string {
  return `phase=agent | thinking=${policy.reasoningMode} | effort=${policy.reasoningEffort ?? 'unspecified'} | effort_source=${policy.reasoningEffortSource ?? 'operation'} | speed=${policy.serviceTier ?? 'auto'} | provider_stream=${policy.streamToProvider ? 'on' : 'off'} | reasoning=${policy.emitReasoning ? 'on' : 'off'} | reasoning_summary=${policy.reasoningSummary ?? 'off'} | verbosity=${policy.textVerbosity ?? 'default'}`
}
