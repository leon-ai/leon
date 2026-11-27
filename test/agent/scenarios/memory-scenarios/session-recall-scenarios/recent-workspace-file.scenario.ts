import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { WorkspaceResourceKind } from '@@/bridges/runtime/contracts/workspace'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const FILENAME = 'handoff-notes.md'
const EXPECTED_CODE = 'NORTH-29'
const OTHER_CODE = 'SOUTH-63'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workingDirectory) => {
      const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
      const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
      const { CONVERSATION_LOGGER } = await import('@/core')

      const seed = async (name: string, code: string): Promise<string> => {
        const folder = path.join(workingDirectory, name)
        const file = path.join(folder, FILENAME)
        await fs.mkdir(folder)
        await fs.writeFile(file, `Handoff code: ${code}\n`)
        const workspace = CONVERSATION_REPOSITORY.workspaces.create({
          name, brief: '', resources: [{ kind: WorkspaceResourceKind.Folder, label: name, location: folder }]
        })
        const session = CONVERSATION_SESSION_MANAGER.createSession(undefined, workspace.id)
        await CONVERSATION_LOGGER.upsert({
          who: 'leon', message: 'I read the handoff notes.', isAddedToHistory: true,
          agentResponseTrace: {
            id: session.id, planSteps: [], toolCalls: [{
              id: session.id, name: 'file_system.file.read', status: 'success',
              output: { result: { success: true, data: { path: file } } }
            }]
          }
        }, { sessionId: session.id })

        return workspace.id
      }

      const workspace = await seed('North Dock', EXPECTED_CODE)
      await seed('South Dock', OTHER_CODE)
      const current = CONVERSATION_SESSION_MANAGER.createSession(undefined, workspace)
      const turn = await context.runTurn('What is the handoff code in the notes we were just working on?', current.id)
      assert.equal(turn.historyBeforeTurn, 0)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes(EXPECTED_CODE) && !turn.output.includes(OTHER_CODE), turn.output)
      assert.ok(turn.executionHistory.some(({ function: name, status }) =>
        name === 'structured_knowledge.sessions.findFiles' && status === 'success'))

      return { turn }
    })
  }
}

export default scenario
