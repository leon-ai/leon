import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { AURORA_QUERY_EXAMPLES } from '../../../../fixtures/aurora'

const INPUT_CASES = [
  { id: 'form', type: 'Form' },
  { id: 'boolean', type: 'BooleanChoice' },
  { id: 'multi-choice', type: 'Choice' }
] as const

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { AgentSessionState } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-session-state')
    const { runWithConversationSession } = await import('@/core/session-manager/session-context')
    const results = []

    // Natural requests leave presentation to the model; each fresh session
    // must choose its own suitable input without copying an earlier surface.
    for (const example of INPUT_CASES) {
      const turn = await runTurn(AURORA_QUERY_EXAMPLES[example.id])
      assert.equal(turn.finalIntent, 'clarification', turn.output)
      const record = CONVERSATION_REPOSITORY.readMessage(turn.sessionId, turn.responseTrace.id)
      const part = record?.answerParts?.find((item) => item.kind === 'ui')
      if (part?.kind !== 'ui') {
        const transcript = runWithConversationSession({ sessionId: turn.sessionId }, () =>
          new AgentSessionState().getContinuationStore().load()?.transcript)
        const exchanges = transcript?.filter((message) => message.role === 'tool' ||
          message.role === 'assistant' && message.toolCalls?.length).slice(-6).map((message) =>
          message.role === 'assistant' ? { role: message.role, toolCalls: message.toolCalls } : message)
        assert.fail(`${example.id} must offer native input without a UI request. ${JSON.stringify(exchanges)}`)
      }
      assert.equal(part.surface.status, 'ready')
      const node = Object.values(part.surface.spec.elements).find((item) => item.type === example.type)
      assert.ok(node, `${example.id} must use ${example.type}.`)
      if (node.type === 'Choice') {
        assert.equal(node.props.multiple, true, 'The owner must be able to select several interests.')
        assert.equal(node.props.options.length, 4)
      }
      if (node.type === 'Form') {
        assert.equal(node.props.fields.length, 3, 'The form must gather the related project details together.')
      }

      results.push({ input: turn.input, sessionId: turn.sessionId, type: node.type, spec: part.surface.spec })
    }

    const simple = await runTurn('What is 2 + 2?')
    assert.equal(simple.finalIntent, 'answer', simple.output)
    assert.ok(simple.output.includes('4'), simple.output)
    const record = CONVERSATION_REPOSITORY.readMessage(simple.sessionId, simple.responseTrace.id)
    assert.ok(!record?.answerParts?.some((part) => part.kind === 'ui'), 'A simple answer must not introduce unnecessary UI.')

    return { inputs: results, simple: simple.output }
  }
}

export default scenario
