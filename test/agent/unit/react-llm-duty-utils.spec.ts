import { describe, expect, it } from 'vitest'

import {
  extractFinalAnswerFromToolResult,
  extractOwnerActionHandoffFromToolResult
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-utils'
import { deriveLLMMetrics, measureOtherProcessingDuration } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-metrics'
import { LLMProviders } from '@/core/llm-manager/types'
import { captureContextUsage, readContextUsage } from '@/core/llm-manager/llm-usage/context-usage'

describe('ReAct LLM duty utilities', () => {
  it('excludes the union of measured intervals from the turn remainder', () => {
    expect(measureOtherProcessingDuration(1_000, 10_000, [
      { startedAt: 3_000, durationMs: 4_000 },
      { startedAt: 1_000, durationMs: 3_000 },
      { startedAt: 8_000, durationMs: 1_000 },
      { startedAt: 8_500, durationMs: 2_000 },
      { startedAt: 4_000, durationMs: 500 }
    ])).toBe(1_500)
  })

  it('bounds coverage to the current turn and omits incomplete accounting', () => {
    expect(measureOtherProcessingDuration(1_000, 10_000, [
      { startedAt: 0, durationMs: 3_000 },
      { startedAt: 10_000, durationMs: 4_000 }
    ])).toBe(7_000)
    expect(measureOtherProcessingDuration(1_000, 10_000, [
      { startedAt: 0, durationMs: 14_000 }
    ])).toBe(0)
    expect(measureOtherProcessingDuration(1_000, 10_000, [])).toBe(10_000)
    expect(measureOtherProcessingDuration(1_000, 10_000, [
      { startedAt: 1_000 }
    ])).toBeUndefined()
    expect(measureOtherProcessingDuration(1_000, 10_000, [
      { startedAt: 1_000, durationMs: -1 }
    ])).toBeUndefined()
  })

  it('keeps prompt occupancy separate from accumulated turn consumption', () => {
    const contextUsage = captureContextUsage({
      usedInputTokens: 200,
      estimatedInputTokens: 300,
      contextWindowTokens: 1_000
    })
    const metrics = deriveLLMMetrics({
      contextUsage,
      providerName: LLMProviders.OpenAI,
      completionCount: 3,
      normalizedOutput: 'Done.',
      totalInputTokens: 2_000,
      totalOutputTokens: 100,
      totalVisibleOutputTokens: 100,
      totalOutputChars: 5,
      totalGenerationDurationMs: 1_000,
      turnDurationMs: 2_000,
      phaseMetrics: {
        agent: { outputTokens: 100, durationMs: 1_000 },
        final_answer: { outputTokens: 0, durationMs: 0 }
      },
      finalAnswerMetrics: null,
      estimateTokensFromText: () => 5
    })

    expect(metrics).toMatchObject({
      inputTokens: 2_000,
      contextUsedTokens: 200,
      contextWindowTokens: 1_000,
      contextUsagePercent: 20,
      contextUsageEstimated: false
    })
  })

  it('distinguishes estimated prompts, reported empty prompts and unknown capacities', () => {
    expect(captureContextUsage({
      estimatedInputTokens: 250,
      contextWindowTokens: 1_000
    })).toEqual({
      contextUsedTokens: 250,
      contextWindowTokens: 1_000,
      contextUsagePercent: 25,
      contextUsageEstimated: true
    })
    expect(captureContextUsage({
      usedInputTokens: 0,
      estimatedInputTokens: 250
    })).toEqual({
      contextUsedTokens: 0,
      contextUsageEstimated: false
    })
    expect(readContextUsage({})).toBeUndefined()
    expect(readContextUsage({
      contextUsedTokens: -1,
      contextUsageEstimated: false
    })).toBeUndefined()
    expect(readContextUsage({
      contextUsedTokens: 250,
      contextWindowTokens: 0,
      contextUsageEstimated: true
    })).toEqual({
      contextUsedTokens: 250,
      contextUsageEstimated: true
    })
  })

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
