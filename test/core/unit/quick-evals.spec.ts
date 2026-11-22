import { describe, expect, it, vi } from 'vitest'

import { TurnStage } from '@/core/llm-manager/turn-timing-contract'
import type { InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { compareQuickEval, evaluateQuickEvalCase, summarizeQuickEvalUsage, type Evaluation } from '../../../scripts/ci/quick-evals'

function record(inputTokens: number, cachedInputTokens: number, stage = TurnStage.AgentLoop): InferenceUsageRecord {
  return {
    id: stage, provider: 'deepseek', model: 'deepseek-flash', stage,
    startedAt: 0, finishedAt: 20, sessionId: 'fixture', purpose: 'fixture', outcome: 'completed',
    usage: { inputTokens, cachedInputTokens, outputTokens: 1 }
  }
}

function sample(inputTokens: number, cachedInputTokens: number): { evaluation: Evaluation } {
  return { evaluation: {
    metrics: summarizeQuickEvalUsage([record(inputTokens, cachedInputTokens)], 100),
    turns: [], diagnostics: { tools: [], calls: [], completionReviews: [] }
  } }
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

  it('accepts one clean sample', async () => {
    const { evaluation: { metrics: baseline } } = sample(100, 50)
    const run = vi.fn().mockResolvedValue(sample(100, 50))
    const result = await evaluateQuickEvalCase(run, 15, 0, baseline)

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ actual: baseline, failures: [], warnings: [] })
  })

  it.each([
    { cachedTokens: [35, 55, 50], median: 50, breaches: 1, warnings: [] },
    { cachedTokens: [35, 55, 40], median: 60, breaches: 2,
      warnings: ['Uncached input growth persisted across samples'] }
  ])('summarizes uncached input after $breaches outlying samples', async ({ cachedTokens, median, breaches, warnings }) => {
    const run = vi.fn()
    for (const cached of cachedTokens) {
      run.mockResolvedValueOnce(sample(100, cached))
    }
    const result = await evaluateQuickEvalCase(run, 15, 0, sample(100, 50).evaluation.metrics)

    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      actual: { uncachedInputTokens: median }, failures: [], warnings,
      notes: [`Uncached input median ${median} tokens, range 45–65 (${breaches}/3 above +15%)`]
    })
    expect(result.samples.map(({ metrics }) => metrics.uncachedInputTokens)).toEqual(cachedTokens.map((cached) => 100 - cached))
  })

  it('blocks on a repeated hard budget breach during uncached-input resampling', async () => {
    const run = vi.fn().mockResolvedValueOnce(sample(100, 35)).mockResolvedValue(sample(120, 80))
    const result = await evaluateQuickEvalCase(run, 15, 0, sample(100, 50).evaluation.metrics)

    expect(run).toHaveBeenCalledTimes(3)
    expect(result.failures).toEqual([
      expect.stringContaining('inputTokens'), expect.stringContaining('peakInputTokens')
    ])
  })

  it('retains the failing child’s reason and diagnostics without retrying a failed assertion', async () => {
    const failedSample = {
      reason: 'AssertionError: expected the verification line', exitCode: 1, timedOut: false,
      diagnostics: { tools: ['operating_system_control.shell.executeCommand'], calls: [], completionReviews: [] }
    }
    const run = vi.fn().mockResolvedValue({ failedSample })
    const result = await evaluateQuickEvalCase(run, 15, 0, sample(100, 50).evaluation.metrics)

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ samples: [], failures: [failedSample.reason], warnings: [], failedSample })
  })
})
