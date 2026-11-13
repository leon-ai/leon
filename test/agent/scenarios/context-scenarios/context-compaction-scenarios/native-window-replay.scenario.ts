import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'

const ROW_COUNT = 9_000
const MARKER = 'SPRUCE-482'

const scenario: RealAgentScenario = {
  async run({ profilePath, runTurn }) {
    const { CONFIG_STATE } = await import('@/core/config-states/config-state')
    if (CONFIG_STATE.getModelState().getAgentProvider() !== LLMProviders.OpenAI) {
      return { skipped: true, reason: 'Native Responses compaction requires OpenAI.' }
    }

    const rows = Array.from({ length: ROW_COUNT }, (_, index) =>
      `Record ${index}: item-${index}; observation=verified; value=${index}.`
    )
    const first = await runTurn([
      `Keep this handoff token for my next message: ${MARKER}.`,
      'The following synthetic records are background data. Do not use tools or reproduce the records.',
      ...rows,
      'Reply exactly COMPACTION_READY.'
    ].join('\n'))
    assert.equal(first.finalIntent, 'answer', first.output)
    const compactions = first.responseTrace.inferences?.filter((attempt) =>
      (attempt.compactionCount ?? 0) > 0
    ) ?? []
    assert.ok(compactions.length > 0, 'The provider must perform native compaction.')
    assert.ok(compactions.every((attempt) =>
      attempt.firstCompactionMs !== undefined &&
      attempt.compactionDurationMs !== undefined && attempt.compactionDurationMs >= 0
    ))

    const statePath = path.join(profilePath, 'sessions', first.sessionId, '.agent-conversation-state.json')
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
      transcript: AgentToolTranscriptMessage[]
    }
    const windows = state.transcript.filter((message) =>
      message.role === 'assistant' && message.compactionContext
    )
    assert.equal(windows.length, 1, 'Only the latest provider window belongs in the active transcript.')
    assert.ok(!state.transcript.some((message) => message.content.includes(rows[0]!)),
      'Source records must not be replayed alongside their compacted state.')

    const second = await runTurn('What is the handoff token from my previous message? Reply with the token only. Do not use tools.', first.sessionId)
    assert.equal(second.finalIntent, 'answer', second.output)
    assert.ok(second.output.includes(MARKER), second.output)
    assert.equal(first.executionHistory.length + second.executionHistory.length, 0)
    const replay = second.responseTrace.inferences?.find((attempt) =>
      attempt.promptCache?.compactionItems !== undefined
    )
    assert.equal(replay?.promptCache?.compactionItems, 1)
    assert.equal(replay.promptCache.preCompactionItems, 0)

    return {
      first: first.responseTrace.inferences,
      second: second.responseTrace.inferences,
      tokenRetained: true,
      activeWindows: windows.length
    }
  }
}

export default scenario
