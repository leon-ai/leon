import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage, OpenAITool, OpenAIToolCall } from '@/core/llm-manager/types'
import { ProviderRetryReason } from '@/core/llm-manager/types'
import { inScenarioWorkspace } from './scenario-fixture'

export enum ModelFault {
  IncorrectDraft = 'incorrect-draft',
  ContextFailure = 'context-failure',
  ReviewContextFailure = 'review-context-failure',
  ReasoningStall = 'reasoning-stall',
  OutputStall = 'output-stall',
  ReasoningExhaustion = 'reasoning-exhaustion',
  RejectedCalls = 'rejected-calls'
}

interface ModelReply {
  textContent?: string
  reasoning?: string
  toolCalls?: OpenAIToolCall[]
  isTruncated?: boolean
}

export type ModelCall = (
  this: unknown,
  messages: AgentToolTranscriptMessage[],
  prompt: string,
  tools: OpenAITool[],
  options: {
    isCompletionReview?: boolean
    isRecoveryAttempt: boolean
    isStallRecoveryAttempt?: boolean
    isContextRecoveryAttempt?: boolean
    isFinalizationAttempt?: boolean
  },
  ...rest: unknown[]
) => Promise<ModelReply | null>

const MARKER = 'verified-inspection-42'

/**
 * Inject controlled model failures while retaining real inference for the work
 * and for completion review.
 */
export function createModelFaultScenario(fault: ModelFault): RealAgentScenario {
  return {
    async run(context): Promise<Record<string, unknown>> {
      return inScenarioWorkspace(context.profilePath, async (workspace) => {
        const { ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty')
        const {
          AgentCompletionStatus, AgentModelProviderError, AgentModelResponseTimeoutError
        } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-loop')
        const prototype = ReActLLMDuty.prototype as unknown as { callAgentModel: ModelCall }
        const original = prototype.callAgentModel
        let injected = false
        let reviews = 0
        let rejections = 0
        let incorrectDrafts = 0
        let finalRevisions = 0
        let stallRecoveries = 0
        let reviewContextRecoveries = 0
        let repeatedReads = 0
        let readsBeforeRejection = 0
        prototype.callAgentModel = async function (...args: Parameters<ModelCall>): Promise<ModelReply | null> {
          const [messages, , , options] = args
          const hasWritten = messages.some((message) => message.role === 'tool' && message.toolName.endsWith('__write'))
          if (!injected && hasWritten && !options.isCompletionReview && fault === ModelFault.ReasoningExhaustion) {
            injected = true
            return { reasoning: 'An unfinished private deliberation.', isTruncated: true }
          }
          if (fault === ModelFault.RejectedCalls && hasWritten && !options.isCompletionReview && !options.isFinalizationAttempt && repeatedReads < 4) {
            const lastWrite = messages.findLastIndex((message) => message.role === 'tool' && message.toolName.endsWith('__write'))
            const read = messages.findLast((message, index) => index > lastWrite && message.role === 'assistant' &&
              message.toolCalls?.some((call) => call.function.name === 'file_system__file__read'))
            const call = read?.role === 'assistant'
              ? read.toolCalls?.find((entry) => entry.function.name === 'file_system__file__read') : undefined
            if (call && messages.some((message) => message.role === 'tool' && message.toolCallId === call.id)) {
              if (repeatedReads === 0) {
                readsBeforeRejection = messages.filter((message) => message.role === 'tool' && message.toolName === call.function.name).length
              }
              repeatedReads += 1
              injected = true
              return { toolCalls: [{ ...call, id: `rejected-read-${repeatedReads}` }] }
            }
          }
          if (!injected && hasWritten && !options.isCompletionReview &&
            (fault === ModelFault.ReasoningStall || fault === ModelFault.OutputStall)) {
            injected = true
            throw new AgentModelResponseTimeoutError({
              providerEventCount: 3, providerCompleted: false, elapsedMs: 90_000,
              reasoningOnly: fault === ModelFault.ReasoningStall, replaySafe: true,
              retryReason: fault === ModelFault.ReasoningStall
                ? ProviderRetryReason.Exhausted
                : ProviderRetryReason.Output
            })
          }
          if (options.isStallRecoveryAttempt) {
            stallRecoveries += 1
          }
          if (!injected && hasWritten && !options.isCompletionReview && fault === ModelFault.ContextFailure) {
            injected = true
            throw new AgentModelProviderError('The controlled provider rejected the context size.', true)
          }
          if (!injected && hasWritten && options.isCompletionReview && fault === ModelFault.ReviewContextFailure) {
            injected = true
            throw new AgentModelProviderError('The controlled provider rejected the review context size.', true)
          }
          if (options.isCompletionReview && options.isContextRecoveryAttempt) {
            reviewContextRecoveries += 1
          }

          const result = await original.apply(this, args)
          if (options.isCompletionReview) {
            reviews += 1
            let review: { status?: string } | undefined
            try {
              review = result?.textContent ? JSON.parse(result.textContent) : undefined
            } catch {
              // Invalid reviews belong to the real review parser and its retry policy.
            }
            if (review?.status === AgentCompletionStatus.Continue ||
                review?.status === AgentCompletionStatus.Revise) {
              rejections += 1
            }
          } else if (fault === ModelFault.IncorrectDraft && hasWritten && result?.textContent && !result.toolCalls?.length) {
            if (options.isFinalizationAttempt) {
              finalRevisions += 1
            } else if (incorrectDrafts < 2) {
              incorrectDrafts += 1
              injected = true
              return { ...result, textContent: `The file contains unsupported-value-${incorrectDrafts}.` }
            }
          }

          return result
        }

        try {
          const turn = await context.runTurn(`Use the file tool to create evidence.txt containing exactly ${MARKER}. Read it back to verify it. Your final answer must quote its exact contents.`)
          assert.ok(injected, 'The failure must occur after a real write, before successful completion.')
          assert.equal(turn.finalIntent, 'answer', turn.output)
          assert.equal((await fs.readFile(path.join(workspace, 'evidence.txt'), 'utf8')).trim(), MARKER)
          assert.ok(turn.output.includes(MARKER))
          assert.equal(turn.executionHistory.filter((execution) => execution.function === 'file_system.file.write').length, 1,
            'Recovery must preserve the completed write rather than replay its side effect.')
          assert.ok(reviews > 0)
          if (fault === ModelFault.IncorrectDraft) {
            assert.equal(rejections, 2, 'Review must reject both unsupported drafts.')
            assert.equal(finalRevisions, 1, 'A bounded final revision must deliver the verified contents.')
            assert.equal(reviews, rejections, 'The final revision must settle the reply without another review.')
          }
          if (fault === ModelFault.ReasoningStall || fault === ModelFault.OutputStall || fault === ModelFault.ReasoningExhaustion) {
            assert.equal(stallRecoveries, 1)
          }
          if (fault === ModelFault.RejectedCalls) {
            assert.equal(repeatedReads, 4)
            assert.equal(turn.executionHistory.filter((execution) => execution.function === 'file_system.file.read').length, readsBeforeRejection)
          }
          if (fault === ModelFault.ReviewContextFailure) {
            assert.equal(reviewContextRecoveries, 1)
          }

          return { turn, injected, reviews, rejections, stallRecoveries, reviewContextRecoveries, repeatedReads }
        } finally {
          prototype.callAgentModel = original
        }
      })
    }
  }
}
