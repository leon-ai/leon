import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const SOURCE_URL = 'https://example.org/community/showcase'
const OWNER_GOAL = 'I would like to demo my open-source neighborhood map at the Cedar Community Showcase. I want to show how a resident can add a missing place to the map. Once proposals open at https://example.org/community/showcase, I will need a five-minute outline with that example.'
const ANNOUNCEMENT = [
  '# Cedar Community Showcase',
  'The organizer has opened demo proposals for the upcoming showcase.',
  'Applications are open now and are accepted until next Friday.',
  'Proposals must include a 5-minute demonstration outline and the project name.'
].join('\n')

const scenario: RealAgentScenario = {
  toolResult(input) {
    if (input.toolkitId !== 'search_web') {
      return undefined
    }

    const matchesSource = input.toolId === 'crawlberg' &&
      input.functionName === 'fetchUrl' && input.parsedInput?.['url'] === SOURCE_URL

    return {
      status: 'success',
      message: 'Research source retrieved.',
      data: {
        tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: input.functionName ?? null,
        input: input.toolInput ?? null, parsed_input: input.parsedInput ?? null,
        output: { result: { success: true, data: {
          url: SOURCE_URL,
          markdown: matchesSource ? ANNOUNCEMENT : 'Read the organizer’s full announcement at ' + SOURCE_URL
        } } }
      }
    }
  },

  async run(context) {
    const { CONFIG_MANAGER } = await import('@/config')
    const { TOOL_EXECUTOR } = await import('@/core')
    const { default: PulseManager } = await import('@/core/pulse-manager/pulse-manager')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)

    const session = CONVERSATION_SESSION_MANAGER.createSession()
    CONVERSATION_SESSION_MANAGER.updateSession(session.id, { title: 'Cedar Community Showcase demo' })
    const ageMs = 60 * 24 * 60 * 60 * 1_000
    CONVERSATION_REPOSITORY.upsertMessage(session.id, {
      who: 'owner', message: OWNER_GOAL, isAddedToHistory: true
    }, { sentAt: Date.now() - ageMs })
    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(session.id)

    const reachedSource = Promise.withResolvers<void>()
    const releaseSource = Promise.withResolvers<void>()
    const executeTool = TOOL_EXECUTOR.executeTool
    TOOL_EXECUTOR.executeTool = async (input): ReturnType<typeof executeTool> => {
      if (input.functionName === 'fetchUrl' && input.parsedInput?.['url'] === SOURCE_URL) {
        reachedSource.resolve()
        await releaseSource.promise
      }

      return executeTool(input)
    }

    const run = new PulseManager().tick('manual')
    try {
      await Promise.race([
        reachedSource.promise,
        run.then(() => {
          throw new Error('Pulse did not verify the organizer’s announcement.')
        })
      ])
      const ownerTurn = await context.runTurn('Reply with the words owner turn completed.', session.id)
      assert.equal(ownerTurn.finalIntent, 'answer', ownerTurn.output)
      assert.match(ownerTurn.output, /owner turn completed/i)
    } finally {
      releaseSource.resolve()
      await run
      TOOL_EXECUTOR.executeTool = executeTool
    }

    const pulseMessages = (): string[] => CONVERSATION_REPOSITORY.readMessages(session.id).items
      .filter((message) => message.origin === 'pulse')
      .map((message) => message.message)
    const [alert] = pulseMessages()
    assert.equal(pulseMessages().length, 1)
    assert.ok(alert?.includes(SOURCE_URL), alert)
    assert.match(alert, /proposals?.*(open|accept)|open.*proposals?/is)
    assert.match(alert, /missing place/i)

    // Advance past the tick cooldown without changing what the organizer announced.
    const statePath = path.join(context.profilePath, 'context', 'private', '.leon-pulse-state.json')
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    state.lastExecutionAt = null
    state.suppressionPolicies = []
    state.matters = [{
      ...state.recentOutcomes[0],
      id: `pulse-${randomUUID()}`,
      status: 'pending',
      completedAt: null,
      surfacedAt: null,
      outcome: null
    }]
    const ownerMessage = CONVERSATION_REPOSITORY.readMessages(session.id).items.findLast((message) =>
      message.who === 'owner'
    )
    assert.ok(ownerMessage?.messageId)
    CONVERSATION_REPOSITORY.upsertMessage(session.id, {
      ...ownerMessage, messageId: ownerMessage.messageId
    }, { sentAt: Date.now() - ageMs })
    await fs.writeFile(statePath, JSON.stringify(state))
    await new PulseManager().tick('manual')
    assert.deepEqual(pulseMessages(), [alert])

    const db = new SQLite(path.join(path.dirname(statePath), 'pulse.sqlite'), { readonly: true })
    try {
      const results = db.prepare('SELECT matter_id, decision FROM results ORDER BY checked_at')
        .all() as Array<{ matter_id: string, decision: string }>
      assert.equal(results.length, 2)
      assert.equal(new Set(results.map((result) => result.matter_id)).size, 1)
      assert.equal(results.filter((result) => result.decision === 'notify').length, 1)
    } finally {
      db.close()
    }

    return { alert }
  }
}

export default scenario
