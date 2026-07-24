import type {
  LLMReasoningMode,
  LLMReasoningSummary,
  LLMTextVerbosity
} from '@/core/llm-manager/types'

export interface AgentInferencePolicy {
  reasoningMode: LLMReasoningMode
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
  return `phase=agent | thinking=${policy.reasoningMode} | budget=provider_default | provider_stream=${policy.streamToProvider ? 'on' : 'off'} | reasoning=${policy.emitReasoning ? 'on' : 'off'} | reasoning_summary=${policy.reasoningSummary ?? 'off'} | verbosity=${policy.textVerbosity ?? 'default'}`
}
