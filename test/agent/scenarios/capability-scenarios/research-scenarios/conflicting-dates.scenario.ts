import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const CURRENT = 'https://example.invalid/caldera/official-release'
const STALE = 'https://example.invalid/caldera/old-announcement'
const scenario: RealAgentScenario = {
  toolResult(input) {
    if (input.toolkitId !== 'search_web') {
      return undefined
    }

    return { status: 'success', message: 'Two dated source excerpts.',
      data: { tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: input.functionName || null,
        input: input.toolInput || null, parsed_input: input.parsedInput || null,
        output: { result: { success: true, data: { results: [
          { title: 'Caldera official release update', url: CURRENT, published: '2026-10-30',
            content: 'General availability is now January 15, 2027. The November 1, 2026 date is a closed beta, not the public launch. This update supersedes the August announcement.' },
          { title: 'Caldera August announcement', url: STALE, published: '2026-08-01',
            content: 'We plan a public launch on November 1, 2026, subject to readiness review.' }
        ] } } } }
    }
  },
  async run(context) {
    const turn = await context.runTurn('Search for Caldera\'s public launch date. Reconcile conflicting dates in the returned sources, distinguish beta from general availability, and cite the source URLs. Use only the returned evidence; no files or shell are needed.')
    assert.equal(turn.finalIntent, 'answer', turn.output)
    assert.ok(turn.executionHistory.some((entry) => entry.function.startsWith('search_web.')))
    assert.ok(turn.output.includes('2027') && turn.output.includes('15') && turn.output.includes('January'), turn.output)
    assert.ok(turn.output.toLowerCase().includes('beta'))
    assert.ok(turn.output.includes(CURRENT) && turn.output.includes(STALE))

    return { turn, externalFixture: 'Controlled dated search excerpts; no public search is made.' }
  }
}

export default scenario
