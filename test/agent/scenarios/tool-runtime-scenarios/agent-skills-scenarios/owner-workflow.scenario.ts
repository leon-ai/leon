import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const directory = path.join(profilePath, 'skills', 'agent', 'handoff-card')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'SKILL.md'), [
      '---', 'name: handoff-card',
      'description: Create a handoff card using the owner\'s required format.', '---',
      'Use the file tool. Create handoff.txt with exactly three lines:',
      'READY FOR REVIEW', 'Owner: <the requested person>', 'Next: <the requested next action>',
      'Read back the file and verify its contents before answering.'
    ].join('\n'))
  },
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const turn = await context.runTurn('Use my handoff-card agent skill for Nora. The next action is Publish release notes. Create and verify the handoff card in this workspace.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      const activities = turn.progressMessages.filter((message) => message.content.includes('skill: handoff-card'))
      assert.equal(activities.length, 2)
      assert.equal(activities[0]!.id, activities[1]!.id)
      assert.equal(activities[0]!.createdAt, activities[1]!.createdAt)
      assert.equal(activities[0]!.content, 'Loaded skill: handoff-card')
      assert.equal(activities[1]!.content, 'Using skill: handoff-card')
      assert.ok(activities.every((activity) => activity.iconName === 'book-ai-line'))
      assert.equal(turn.responseTrace.progressMessages?.filter((message) => message.id === activities[0]!.id).length, 1)
      assert.equal((await fs.readFile(path.join(workspace, 'handoff.txt'), 'utf8')).trim(),
        'READY FOR REVIEW\nOwner: Nora\nNext: Publish release notes')
      const state = JSON.parse(await fs.readFile(path.join(context.profilePath, 'sessions', turn.sessionId, '.agent-conversation-state.json'), 'utf8'))
      assert.ok(state.transcript.some((message: { role: string, runtimeContext?: { active_skill?: { name: string, instructions: string } } }) =>
        message.role === 'user' && message.runtimeContext?.active_skill?.name === 'handoff-card' &&
        message.runtimeContext.active_skill.instructions.includes('READY FOR REVIEW')),
      'The skill must be activated as agent guidance, not merely read as an ordinary file.')

      return { turn }
    })
  }
}

export default scenario
