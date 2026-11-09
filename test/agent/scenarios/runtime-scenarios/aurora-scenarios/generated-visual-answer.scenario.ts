import assert from 'node:assert/strict'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { AURORA_QUERY_EXAMPLES } from '../../../../fixtures/aurora'

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { validateGeneratedSurfaces } = await import('@/core/aurora/generated-validation')
    const turn = await runTurn(AURORA_QUERY_EXAMPLES['reading-dashboard'])
    assert.ok(turn.finalIntent === 'answer' || turn.finalIntent === 'clarification', turn.output)
    const record = CONVERSATION_REPOSITORY.readMessage(turn.sessionId, turn.responseTrace.id)
    const surfaces = record?.answerParts?.flatMap((part) => part.kind === 'ui' ? [part.surface] : []) ?? []
    const generated = surfaces.flatMap((surface) => Object.values(surface.spec.elements)
      .filter((node) => node.type === 'Generated'))
    assert.ok(generated.length, 'A data comparison with adjustable goals must offer a bespoke interactive visual without a widget request.')
    for (const surface of surfaces) {
      assert.equal(surface.status, 'ready')
      assert.deepEqual(validateGeneratedSurfaces(surface.spec), [])
    }
    assert.ok(generated.some((node) => node.props.javascript?.length), 'The visual must include local interaction, not a static image.')
    assert.ok(generated.every((node) => node.props.fallback.length), 'The answer must remain readable without executable presentation.')

    return { sessionId: turn.sessionId, answer: turn.output, surfaces }
  }
}

export default scenario
