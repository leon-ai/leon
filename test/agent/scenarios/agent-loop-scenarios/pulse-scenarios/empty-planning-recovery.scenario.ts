import assert from 'node:assert/strict'

import type { CompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-types'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { CONFIG_MANAGER } = await import('@/config')
    const { LLM_PROVIDER } = await import('@/core')
    const { PulseTickOutcome } = await import('@/core/insights/insights-contract')
    const { InferencePurpose, LLMDuties } = await import('@/core/llm-manager/types')
    const { default: PulseManager } = await import('@/core/pulse-manager/pulse-manager')
    const { getPulseResultRepository } = await import('@/core/pulse-manager/pulse-result-repository')
    const { PulseFailureCode } = await import('@/core/telemetry/report-contract')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)

    const prompt = LLM_PROVIDER.prompt
    const pulse = new PulseManager()
    const results = getPulseResultRepository()
    const quietDecision = 'There is no new signal that needs investigation.'
    let planningCalls = 0

    LLM_PROVIDER.prompt = async (input, params): Promise<CompletionResult | null> => {
      if (params?.usagePurpose !== InferencePurpose.PulsePlanning) {
        return prompt(input, params)
      }

      planningCalls += 1
      return {
        dutyType: LLMDuties.Inference,
        systemPrompt: '',
        input: '',
        output: planningCalls === 1 ? '' : JSON.stringify({ items: [], why: quietDecision }),
        data: null,
        maxTokens: params.maxTokens,
        usedInputTokens: 100,
        usedOutputTokens: planningCalls === 1 ? 0 : 16,
        generationDurationMs: 10,
        temperature: 0,
        finishReason: 'stop'
      }
    }

    try {
      await pulse.tick('manual')

      const [failed] = results.readTickHistory(0, true).ticks
      assert.equal(failed?.outcome, PulseTickOutcome.Failed)
      assert.equal(failed.investigated, false)
      const failure = failed.events.find(({ code }) => code === PulseFailureCode.PlanningInference)
      assert.ok(failure?.diagnosticId, 'An empty planning response should leave a diagnostic.')

      await pulse.tick('manual')

      const { total, outcomes, ticks } = results.readTickHistory(0, true)
      assert.equal(total, 2)
      assert.equal(planningCalls, 2)
      assert.equal(outcomes[PulseTickOutcome.Idle], 1)
      const quiet = ticks.find(({ outcome }) => outcome === PulseTickOutcome.Idle)
      assert.equal(quiet?.investigated, false)
      assert.equal(quiet.events.find(({ code }) => code === 'no_lead')?.detail, quietDecision)

      return { ticks }
    } finally {
      LLM_PROVIDER.prompt = prompt
    }
  }
}

export default scenario
