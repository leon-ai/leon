import { describe, expect, it } from 'vitest'

import { TurnStage } from '@/core/llm-manager/turn-timing-contract'
import type { InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { compareQuickEval, summarizeQuickEvalUsage } from '../../../scripts/ci/quick-evals'

function record(inputTokens: number, cachedInputTokens: number, stage = TurnStage.AgentLoop): InferenceUsageRecord {
  return {
    id: stage, provider: 'deepseek', model: 'deepseek-flash', stage,
    startedAt: 0, finishedAt: 20, sessionId: 'fixture', purpose: 'fixture', outcome: 'completed',
    usage: { inputTokens, cachedInputTokens, outputTokens: 1 }
  }
}

describe('Quick Evals release budgets', () => {
  it('includes all metered requests and distinguishes foreground from maintenance', () => {
    const result = summarizeQuickEvalUsage([
      record(90, 0), record(100, 80), record(10, 0, TurnStage.PostTurn)
    ], 100)

    expect(result).toMatchObject({
      inputTokens: 200, cachedInputTokens: 80, uncachedInputTokens: 120, peakInputTokens: 100,
      foregroundInputTokens: 190, maintenanceInputTokens: 10, outputTokens: 3, modelCalls: 3
    })
    const missing = record(1, 0)
    delete missing.usage.cachedInputTokens
    expect(() => summarizeQuickEvalUsage([missing], 100)).toThrow('cache usage')
  })

  it('fails above input and model-call budgets while treating latency as a warning', () => {
    const baseline = summarizeQuickEvalUsage([record(100, 50)], 100)
    const observed = { ...baseline, inputTokens: 115, peakInputTokens: 115, turnLatencyMs: 130 }
    expect(compareQuickEval(observed, baseline, 15, 0)).toMatchObject({
      failures: [], warnings: [expect.stringContaining('turnLatencyMs')]
    })
    const regression = { ...observed, inputTokens: 116, peakInputTokens: 116, modelCalls: 2 }
    expect(compareQuickEval(regression, baseline, 15, 0).failures).toEqual([
      expect.stringContaining('inputTokens'), expect.stringContaining('peakInputTokens'),
      expect.stringContaining('modelCalls')
    ])
  })
})
