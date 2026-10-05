import { describe, expect, it } from 'vitest'

import {
  extractFinalAnswerFromToolResult,
  extractOwnerActionHandoffFromToolResult
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-utils'
import { deriveLLMMetrics } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-metrics'
import { LLMProviders } from '@/core/llm-manager/types'

describe('ReAct LLM duty utilities', () => {
  it('reports the wait from turn start instead of the final request alone', () => {
    const metrics = deriveLLMMetrics({
      providerName: LLMProviders.OpenAI,
      completionCount: 2,
      normalizedOutput: 'Done.',
      totalInputTokens: 100,
      totalOutputTokens: 10,
      totalVisibleOutputTokens: 10,
      totalOutputChars: 5,
      totalGenerationDurationMs: 1_000,
      turnDurationMs: 12_000,
      turnTtftMs: 8_000,
      phaseMetrics: {
        agent: { outputTokens: 5, durationMs: 9_000 },
        final_answer: { outputTokens: 5, durationMs: 3_000 }
      },
      finalAnswerMetrics: {
        inputTokens: 50, outputTokens: 5, ttftMs: 2_000,
        requestDurationMs: 3_000, finalAnswerDurationMs: 1_000
      },
      estimateTokensFromText: () => 5
    })

    expect(metrics.ttftMs).toBe(8_000)
    expect(metrics.finalAnswerDurationMs).toBe(1_000)
  })

  it('extracts a terminal answer wrapped by the Node tool runtime', () => {
    expect(extractFinalAnswerFromToolResult({
      status: 'success',
      data: {
        output: {
          result: {
            final_answer: 'Background result.'
          }
        }
      }
    })).toBe('Background result.')
  })

  it('extracts a terminal owner-action handoff from a wrapped tool result', () => {
    expect(extractOwnerActionHandoffFromToolResult({
      data: {
        output: {
          result: {
            success: false,
            status: 'owner_action_required',
            owner_action: {
              message: 'Enable browser access, then tell me to retry.'
            }
          }
        }
      }
    })).toEqual({
      intent: 'clarification',
      draft: 'Enable browser access, then tell me to retry.'
    })
  })

  it('does not elevate advisory guidance without an owner action', () => {
    expect(extractOwnerActionHandoffFromToolResult({
      data: {
        output: {
          result: {
            status: 'owner_action_required',
            guidance: 'Try another tool.'
          }
        }
      }
    })).toBeNull()
  })
})
