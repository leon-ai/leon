import assert from 'node:assert/strict'
import path from 'node:path'

import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'

const FIRST_LABEL = 'amber-kite-47'
const SECOND_LABEL = 'cobalt-pine-83'

const scenario: RealAgentScenario = {
  toolResult(input) {
    // This mechanism needs real inference, not side effects on external services.
    return {
      status: 'success', message: 'No external lookup is needed. Use the label in the conversation.',
      data: {
        tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: input.functionName,
        input: input.toolInput || null, parsed_input: input.parsedInput || null,
        output: { result: { success: true, data: { external_lookup_required: false } } }
      }
    }
  },
  async run({ profilePath, runTurn }) {
    // Core imports must follow the runner's temporary-home initialization.
    const { ConversationRepository } = await import('@/core/session-manager/conversation-repository')
    const [first, second] = await Promise.all([
      runTurn(`For this conversation the label is ${FIRST_LABEL}. Reply with this label only; do not use tools.`),
      runTurn(`For this conversation the label is ${SECOND_LABEL}. Reply with this label only; do not use tools.`)
    ])
    assert.notEqual(first.sessionId, second.sessionId)
    assert.equal(first.finalIntent, 'answer', JSON.stringify(first))
    assert.equal(second.finalIntent, 'answer', JSON.stringify(second))
    assert.ok(first.output.includes(FIRST_LABEL), first.output)
    assert.ok(second.output.includes(SECOND_LABEL), second.output)

    // A separate archive connection must recover both histories without relying
    // on the executing duties, selected session, or their in-memory transcripts.
    const archive = new ConversationRepository(path.join(profilePath, 'sessions'))
    try {
      for (const [turn, expected, excluded] of [
        [first, FIRST_LABEL, SECOND_LABEL],
        [second, SECOND_LABEL, FIRST_LABEL]
      ] as const) {
        const messages = archive.readAllMessages(turn.sessionId)
        assert.ok(messages.some((message) => message.who === 'owner' && message.message.includes(expected)))
        assert.ok(messages.some((message) => message.who === 'leon' && message.isAddedToHistory && message.message.includes(expected)))
        assert.ok(!messages.some((message) => message.message.includes(excluded)))
      }
    } finally {
      archive.close()
    }

    const followUp = await runTurn('What is the label for this conversation? Reply with the label only; do not use tools.', first.sessionId)
    assert.equal(followUp.finalIntent, 'answer', JSON.stringify(followUp))
    assert.ok(followUp.historyBeforeTurn >= 2)
    assert.ok(followUp.output.includes(FIRST_LABEL), followUp.output)
    assert.ok(!followUp.output.includes(SECOND_LABEL), followUp.output)

    return { first, second, followUp }
  }
}

export default scenario
