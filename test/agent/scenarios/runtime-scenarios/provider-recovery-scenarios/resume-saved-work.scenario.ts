import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const RECEIPT = 'verified-release-42'
const OWNER_WAIT_MS = 2 * 24 * 60 * 60 * 1_000

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
      const { runWithConversationSession } = await import('@/core/session-manager/session-context')
      const { AgentSessionState } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-session-state')
      const { createAgentLoopContinuationState } = await import('@/core/llm-manager/llm-duties/react-llm-duty/agent-loop-continuation')
      const { ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty')
      const session = CONVERSATION_SESSION_MANAGER.createSession()
      const filename = path.join(workspace, 'receipt.txt')
      await fs.writeFile(filename, RECEIPT)
      const input = `Create ${filename} containing ${RECEIPT}, then report the saved receipt's exact contents.`
      const state = createAgentLoopContinuationState({
        originalInput: input, clarificationQuestion: 'The model is temporarily unavailable.',
        planWidgetId: 'receipt-plan', activeSkillId: null,
        loadedToolkitIds: ['file_system'], loadedToolNames: ['file_system.file'],
        loadedFunctionNames: ['file_system.file.write', 'file_system.file.read'],
        trackedSteps: [
          { label: 'Save receipt', status: 'completed', details: `Saved and verified ${filename}: ${RECEIPT}.` },
          { label: 'Report receipt contents', status: 'pending' }
        ],
        executionHistory: [{
          function: 'file_system.file.write', status: 'success',
          requestedToolInput: JSON.stringify({ path: filename, content: RECEIPT }),
          observation: `Saved and verified ${filename}: ${RECEIPT}.`
        }],
        transcript: [
          { role: 'user', content: input },
          { role: 'assistant', content: '', toolCalls: [{
            id: 'saved-receipt', type: 'function', function: {
              name: 'file_system__file__write', arguments: JSON.stringify({ path: filename, content: RECEIPT })
            }
          }] },
          { role: 'tool', toolCallId: 'saved-receipt', toolName: 'file_system__file__write',
            content: `Saved and verified ${filename}: ${RECEIPT}.` }
        ]
      })
      state.createdAt -= OWNER_WAIT_MS
      const store = runWithConversationSession({ sessionId: session.id }, () =>
        new AgentSessionState().getContinuationStore()
      )
      store.save(state)

      // Fail before operational inference so merely opening a saved task cannot
      // consume its only recovery point.
      const prototype = ReActLLMDuty.prototype as unknown as {
        buildAgentGrounding: (...args: unknown[]) => Promise<Record<string, unknown>>
      }
      const original = prototype.buildAgentGrounding
      prototype.buildAgentGrounding = async (): Promise<Record<string, unknown>> => {
        throw new Error('Grounding is temporarily unavailable.')
      }
      try {
        await assert.rejects(context.runTurn('Continue the saved task.', session.id), /returned no result/)
        assert.deepEqual(store.load(), state)
      } finally {
        prototype.buildAgentGrounding = original
      }

      const turn = await context.runTurn('Continue the saved task.', session.id)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes(RECEIPT), turn.output)
      assert.equal(await fs.readFile(filename, 'utf8'), RECEIPT)
      assert.equal(turn.toolCalls.filter((call) => call.toolId === 'file' && call.functionName === 'write').length, 0)
      assert.equal(turn.executionHistory.filter((execution) => execution.function === 'file_system.file.write').length, 1)
      assert.equal(store.load(), null)

      return { turn, ownerWaitMs: OWNER_WAIT_MS }
    })
  }
}

export default scenario
