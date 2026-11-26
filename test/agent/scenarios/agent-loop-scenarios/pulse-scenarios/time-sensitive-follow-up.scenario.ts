import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const SOURCE_URL = 'https://example.org/makers/showcase'
const DAY_MS = 24 * 60 * 60 * 1_000
const MIDNIGHT_UTC = Math.floor(Date.now() / DAY_MS) * DAY_MS
const SCHEDULE_RELEASE = new Date(MIDNIGHT_UTC + 2 * DAY_MS).toISOString()
const PROPOSAL_DEADLINE = new Date(MIDNIGHT_UTC + 5 * DAY_MS).toISOString()
const DAYS_TO_SHOWCASE = (8 - new Date(MIDNIGHT_UTC).getUTCDay()) % 7 + 7
const SHOWCASE_DATE = new Date(MIDNIGHT_UTC + DAYS_TO_SHOWCASE * DAY_MS).toISOString().slice(0, 10)

let schedulePublished = false

const scenario: RealAgentScenario = {
  toolResult(input) {
    if (input.toolkitId !== 'search_web') {
      return undefined
    }

    const markdown = [
      '# Riverfront Makers Showcase',
      `Demo proposals are open until ${PROPOSAL_DEADLINE}.`,
      ...(schedulePublished ? [
        'The organizer has published the final session list.',
        `A demo slot for open-source accessibility projects is confirmed for Monday ${SHOWCASE_DATE} at 10:15 UTC. Application instructions: choose this slot in the proposal form and include a brief demo outline.`
      ] : [
        `The organizer publishes the Monday session list on ${SCHEDULE_RELEASE}. Applicants should check the session list before applying.`,
        'The Monday session list is pending. The organizer has not confirmed a slot for accessibility projects yet.'
      ])
    ].join('\n')

    return {
      status: 'success',
      message: 'Organizer announcement retrieved.',
      data: {
        toolkit_id: input.toolkitId, tool_id: input.toolId, function_name: input.functionName ?? null,
        input: input.toolInput ?? null, parsed_input: input.parsedInput ?? null,
        output: { result: { success: true, data: { url: SOURCE_URL, markdown } } }
      }
    }
  },

  async run({ profilePath }) {
    const { CONFIG_MANAGER } = await import('@/config')
    const { default: PulseManager } = await import('@/core/pulse-manager/pulse-manager')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)

    const session = CONVERSATION_SESSION_MANAGER.createSession()
    CONVERSATION_SESSION_MANAGER.updateSession(session.id, { title: 'Riverfront Makers Showcase application' })
    CONVERSATION_REPOSITORY.upsertMessage(session.id, {
      who: 'owner',
      message: 'I want to demo my open-source accessibility project at the Riverfront Makers Showcase. Monday is the only day I can attend. A Monday accessibility demo slot decides whether I submit a proposal. The organizer posts both the application and the session schedule at ' + SOURCE_URL + '.',
      isAddedToHistory: true
    }, { sentAt: Date.now() - 14 * DAY_MS })
    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(session.id)

    await new PulseManager().tick('manual')

    const privatePath = path.join(profilePath, 'context', 'private')
    const statePath = path.join(privatePath, '.leon-pulse-state.json')
    const db = new SQLite(path.join(privatePath, 'pulse.sqlite'))
    try {
      const agenda = db.prepare('SELECT id, check_at, expires_at FROM matters WHERE archive_reason IS NULL').all()
      assert.equal(agenda.length, 1, 'A published schedule date should justify one bounded follow-up.')
      const [matter] = agenda
      assert.ok(matter)
      const id = String(matter['id'])
      assert.ok(Number(matter['check_at']) >= Date.parse(SCHEDULE_RELEASE))
      assert.ok(Number(matter['expires_at']) <= Date.parse(PROPOSAL_DEADLINE))

      // Make the scheduled check due and publish the organizer’s next announcement.
      db.prepare('UPDATE matters SET check_at = ? WHERE id = ?').run(Date.now() - 1_000, id)
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
      state.lastExecutionAt = null
      await fs.writeFile(statePath, JSON.stringify(state))
      schedulePublished = true

      await new PulseManager().tick('manual')

      const alerts = CONVERSATION_REPOSITORY.readMessages(session.id).items
        .filter((message) => message.origin === 'pulse')
      const results = db.prepare('SELECT id, matter_id FROM results ORDER BY checked_at').all()
      assert.deepEqual(results.map((result) => result['matter_id']), [id, id])
      const followUp = alerts.find((alert) => alert.messageId === results.at(-1)?.['id'])
      assert.match(followUp?.message ?? '', /Monday/i)
      assert.ok(followUp?.message.includes(SOURCE_URL), followUp?.message)
      assert.equal(db.prepare('SELECT archive_reason FROM matters WHERE id = ?').get(id)?.['archive_reason'], 'resolved')

      return { matterId: id, followUp: followUp.message }
    } finally {
      db.close()
    }
  }
}

export default scenario
