import { describe, expect, it, vi } from 'vitest'

import { TurnStage } from '@/core/turn-lifecycle/observability/timing-contract'
import type { InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { compareQuickEval, evaluateQuickEvalCase, summarizeQuickEvalUsage, type Evaluation } from '../../../scripts/ci/quick-evals'

function record(inputTokens: number, cachedInputTokens: number, stage = TurnStage.AgentLoop): InferenceUsageRecord {
  return {
    id: stage, provider: 'deepseek', model: 'deepseek-flash', stage,
    startedAt: 0, finishedAt: 20, sessionId: 'fixture', purpose: 'fixture', outcome: 'completed',
    usage: { inputTokens, cachedInputTokens, outputTokens: 1 }
  }
}

function sample(
  inputTokens: number,
  cachedInputTokens: number,
  ...additionalRequests: InferenceUsageRecord[]
): { evaluation: Evaluation } {
  return { evaluation: {
    metrics: summarizeQuickEvalUsage([record(inputTokens, cachedInputTokens), ...additionalRequests], 100),
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

  it('reports an isolated hard budget breach after two samples stay within budget', async () => {
    const clean = sample(100, 50)
    const run = vi.fn().mockResolvedValueOnce(sample(120, 80)).mockResolvedValue(clean)
    const result = await evaluateQuickEvalCase(run, 15, 0, clean.evaluation.metrics)

    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      failures: [], warnings: ['Initial samples showed isolated budget breaches']
    })
  })

  it('blocks when a budget breach found during uncached resampling repeats in the confirmation batch', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(sample(100, 35))
      .mockResolvedValueOnce(sample(120, 80))
      .mockResolvedValueOnce(sample(120, 80))
      .mockResolvedValueOnce(sample(100, 50))
      .mockResolvedValueOnce(sample(121, 80))
      .mockResolvedValueOnce(sample(121, 80))
    const result = await evaluateQuickEvalCase(run, 15, 0, sample(100, 50).evaluation.metrics)

    expect(run).toHaveBeenCalledTimes(6)
    expect(result.samples.map(({ metrics }) => metrics.inputTokens)).toEqual([100, 120, 120, 100, 121, 121])
    expect(result.failures).toEqual([
      'inputTokens grew from 100 to 121 (limit +15%)',
      'peakInputTokens grew from 100 to 121 (limit +15%)'
    ])
    expect(result.notes).toContain('peakInputTokens exceeded its budget in 2/3 initial samples and 2/3 confirmation samples')
  })

  it('reports an inconclusive breach when the confirmation batch exceeds a different budget', async () => {
    const baseline = sample(100, 75, record(80, 55)).evaluation.metrics
    const peakBreach = sample(120, 90, record(60, 40))
    const inputBreach = sample(110, 85, record(110, 85))
    const run = vi.fn()

    for (const attempt of [peakBreach, peakBreach, inputBreach, inputBreach, peakBreach, inputBreach]) {
      run.mockResolvedValueOnce(attempt)
    }
    const result = await evaluateQuickEvalCase(run, 15, 0, baseline)

    expect(run).toHaveBeenCalledTimes(6)
    expect(result).toMatchObject({
      failures: [],
      warnings: ['peakInputTokens budget breach was inconclusive'],
      notes: ['peakInputTokens exceeded its budget in 2/3 initial samples and 1/3 confirmation samples']
    })
  })

  it.each([0, 4])('stops at a failed assertion after %i successful samples and retains its diagnostics',
    async (successfulSamples) => {
      const failedSample = {
        reason: 'AssertionError: expected the verification line', exitCode: 1, timedOut: false,
        diagnostics: { tools: ['operating_system_control.shell.executeCommand'], calls: [], completionReviews: [] }
      }
      const run = vi.fn().mockResolvedValue({ failedSample })

      for (let index = 0; index < successfulSamples; index += 1) {
        run.mockResolvedValueOnce(sample(120, 80))
      }
      const result = await evaluateQuickEvalCase(run, 15, 0, sample(100, 50).evaluation.metrics)

      expect(run).toHaveBeenCalledTimes(successfulSamples + 1)
      expect(result.samples).toHaveLength(successfulSamples)
      expect(result).toMatchObject({ failures: [failedSample.reason], warnings: [], failedSample })
    })
})
