import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { TOOL_EXECUTION_MANAGER, ToolExecutionState } = await import('@/core/tool-manager/tool-execution-manager')
    const { getActiveProfileName } = await import('@/core/profile-runtime/profile-context')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const profile = getActiveProfileName()
    const session = CONVERSATION_SESSION_MANAGER.createSession().id
    let starts = 0
    const id = TOOL_EXECUTION_MANAGER.start(profile, session, 'scenario-command', async (signal) => {
      starts += 1
      await promisify(execFile)(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { signal })
      throw new Error('The owner must cancel this command before it completes.')
    })
    try {
      const waiting = await TOOL_EXECUTION_MANAGER.wait(profile, session, id, 0)
      assert.equal(waiting.execution.state, ToolExecutionState.Running)
      assert.throws(() => TOOL_EXECUTION_MANAGER.read(profile, 'other-conversation', id), /not found/)
      assert.throws(() => TOOL_EXECUTION_MANAGER.read(`${profile}-other`, session, id), /not found/)
      const canceled = await TOOL_EXECUTION_MANAGER.cancel(profile, session, id)
      assert.equal(canceled.execution.state, ToolExecutionState.Canceled)
      assert.equal(TOOL_EXECUTION_MANAGER.read(profile, session, id).execution.state, ToolExecutionState.Canceled)
      assert.equal(starts, 1)

      return { id, starts, canceled: canceled.execution }
    } finally {
      await TOOL_EXECUTION_MANAGER.cancel(profile, session, id)
    }
  }
}

export default scenario
