import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const MONTHS = ['June', 'July', 'August', 'September', 'October', 'November']
const TOKENS = [120_000, 180_000, 150_000, 300_000, 210_000, 90_000]

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const trend = await runTurn(
      `My recorded token totals for 2026 are ${MONTHS.map((month, index) => `${month}: ${TOKENS[index]}`).join(', ')}. November covers only the first ten days. Show me my usage over these six months so I can understand how it changed.`
    )
    assert.equal(trend.finalIntent, 'answer', trend.output)
    const record = CONVERSATION_REPOSITORY.readMessage(trend.sessionId, trend.responseTrace.id)
    const surfaces = record?.answerParts?.flatMap((part) => part.kind === 'ui' ? [part.surface] : []) ?? []
    const chart = surfaces.flatMap((surface) => Object.values(surface.spec.elements))
      .find((node) => node.type === 'Chart')
    assert.ok(chart?.type === 'Chart', 'A numerical time comparison should lead with a native chart, without an explicit chart request.')
    assert.equal(chart.props.categories.length, MONTHS.length)
    assert.deepEqual(chart.props.series[0]?.values, TOKENS, 'Chart values must preserve the supplied token totals.')
    assert.match(`${chart.props.description ?? ''} ${trend.output}`, /partial|ten days|10 days|first 10|first ten/i)

    const reference = await runTurn('Give me a small reference table for these settings: timeout 30 seconds, retry limit 2, cache enabled. These are fixed values, not a trend.')
    assert.equal(reference.finalIntent, 'answer', reference.output)
    const plain = CONVERSATION_REPOSITORY.readMessage(reference.sessionId, reference.responseTrace.id)
    assert.ok(!plain?.answerParts?.some((part) => part.kind === 'ui'), 'A small static reference table should remain Markdown, not an interactive widget.')
    assert.ok(reference.output.includes('|'), 'The fixed settings should be readable as a Markdown table.')

    return { trend: { sessionId: trend.sessionId, chart, answer: trend.output }, reference: reference.output }
  }
}

export default scenario
