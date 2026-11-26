import type {
  AgentToolTranscriptMessage,
  LLMReasoningEffort,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import type { LLMModelReasoning } from '@/core/llm-manager/llm-model-catalog'

import { AGENT_TOOLKIT_LOADER_NAME } from './agent-constants'
import { findCompletedToolExchanges } from './agent-context-budget'
import type { AgentLoopParams } from './agent-loop'

const DESKTOP_TOOLKIT_ID = 'computer_use'
const CUA_TOOL_PREFIX = `${DESKTOP_TOOLKIT_ID}__cua__`
const DESKTOP_REASONING_EFFORTS: readonly LLMReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
]
const DESKTOP_FOCUS_INSTRUCTIONS = '<desktop_context>Use the current desktop evidence. For work that needs another tool or earlier evidence, select the relevant tool or look it up to return to the full conversation.</desktop_context>'
const FULL_CONTEXT_RECONSIDERATION = 'Reconsidering this proposal with the full conversation.'

type ModelCall = AgentLoopParams['callModel']
type ModelOptions = Parameters<ModelCall>[2]
type FocusedModelCall = (
  transcript: AgentToolTranscriptMessage[],
  options: ModelOptions & { isDesktopDecision?: boolean }
) => ReturnType<ModelCall>

/**
 * Chooses the lightest explicit reasoning effort the active model supports.
 */
export function resolveDesktopFocusReasoningEffort(
  supportedEfforts: readonly LLMModelReasoning[] | undefined
): LLMReasoningEffort | undefined {
  return DESKTOP_REASONING_EFFORTS.find((effort) => supportedEfforts?.includes(effort))
}

/**
 * Identifies proposals that can use the current desktop evidence directly.
 */
export function isDesktopAgentToolCall(call: OpenAIToolCall): boolean {
  if (call.function.name.startsWith(CUA_TOOL_PREFIX)) {
    return true
  }
  if (call.function.name === AGENT_TOOLKIT_LOADER_NAME) {
    try {
      return JSON.parse(call.function.arguments)?.['toolkit_id'] === DESKTOP_TOOLKIT_ID
    } catch {
      return false
    }
  }

  return false
}

/**
 * Prepares a per-request view after a successful visual desktop exchange.
 * Keep owner messages and current work available alongside the desktop evidence.
 */
export function projectDesktopAgentContext(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] | null {
  // Provider-native compaction can carry constraints that cannot be sliced.
  if (transcript.some((message) => message.role === 'assistant' && message.compactionContext)) {
    return null
  }

  const ownerIndex = transcript.findLastIndex((message) => message.role === 'user' && !message.runtimeContext)
  if (ownerIndex < 0) {
    return null
  }

  const latest = findCompletedToolExchanges(transcript).findLast((exchange) =>
    !exchange.assistantMessage.toolCalls.every((call) =>
      call.function.name === AGENT_TOOLKIT_LOADER_NAME && isDesktopAgentToolCall(call)
    )
  )
  if (!latest || latest.startIndex <= ownerIndex ||
      !latest.toolMessages.every((message) => message.toolName.startsWith(CUA_TOOL_PREFIX))) {
    return null
  }

  const observation = latest.toolMessages.at(-1)
  if (!observation?.files?.some((file) => file.mediaType.startsWith('image/') && !file.inspectionPending)) {
    return null
  }

  for (const message of latest.toolMessages) {
    try {
      if (JSON.parse(message.content)?.['status'] !== 'success') {
        return null
      }
    } catch {
      return null
    }
  }

  const prior = transcript.slice(0, ownerIndex)
  const priorAnswer = prior.findLast(
    (message) => message.role === 'assistant' && !message.toolCalls?.length && Boolean(message.content)
  )
  const retained = prior.filter((message) => message.role === 'user' || message === priorAnswer)

  return [...retained, ...transcript.slice(ownerIndex)]
}

/**
 * Uses Desktop Focus for grounded decisions and restores the full request
 * before executing any proposal that needs broader context.
 */
export async function callWithDesktopFocus(
  transcript: AgentToolTranscriptMessage[],
  options: ModelOptions,
  callModel: FocusedModelCall,
  closeProposal: (toolCallId: string, message: string) => void
): ReturnType<ModelCall> {
  const focusedTranscript = !options.isRecoveryAttempt && !options.isContextRecoveryAttempt &&
    !options.isOutputRecoveryAttempt && !options.isStallRecoveryAttempt &&
    !options.isFinalizationAttempt && !options.hasPendingImages && !options.requiresPlanReconciliation
    ? projectDesktopAgentContext(transcript)
    : null

  if (focusedTranscript) {
    focusedTranscript.push({ role: 'user', content: DESKTOP_FOCUS_INSTRUCTIONS })
    const proposal = await callModel(focusedTranscript, { ...options, isDesktopDecision: true })

    if (proposal && !proposal.compactionContext && (proposal.toolCalls ?? []).every(isDesktopAgentToolCall)) {
      return proposal
    }

    // A mixed batch was only proposed. Reconsider it before any input is sent.
    for (const call of proposal?.toolCalls ?? []) {
      closeProposal(call.id, FULL_CONTEXT_RECONSIDERATION)
    }
  }

  return callModel(transcript, options)
}
