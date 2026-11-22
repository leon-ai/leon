import assert from 'node:assert/strict'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const DAY_MS = 24 * 60 * 60 * 1_000
const SOURCE_URL = 'https://example.org/cedar-grants/spring-awards'

const scenario: RealAgentScenario = {
  toolResult(input) {
    if (input.toolId !== 'crawlberg' || input.functionName !== 'fetchUrl' ||
      input.parsedInput?.['url'] !== SOURCE_URL) {
      return undefined
    }

    return {
      status: 'success',
      message: 'Official Cedar Grants awards page retrieved.',
      data: {
        toolkit_id: input.toolkitId, tool_id: input.toolId, function_name: input.functionName,
        input: input.toolInput ?? null, parsed_input: input.parsedInput ?? null,
        output: { result: { success: true, data: {
          url: SOURCE_URL,
          markdown: 'Cedar Grants spring awards are final. The Sidewalk Atlas project was awarded a grant.'
        } } }
      }
    }
  },

  async run(context) {
    const { CONFIG_MANAGER } = await import('@/config')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const { PulseDecision, PulseResultRepository } = await import('@/core/pulse-manager/pulse-result-repository')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)

    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const directory = path.join(context.profilePath, 'context', 'private')
      const repository = new PulseResultRepository(directory)
      const origin = CONVERSATION_SESSION_MANAGER.createSession()
      const ownerChat = CONVERSATION_SESSION_MANAGER.createSession()
      const now = Date.now()
      const matters = [
        {
          fingerprint: 'northbank-sponsorship', targetScope: 'northbank_media',
          summary: 'Northbank Media video sponsorship',
          turnPrompt: 'Has Northbank Media agreed to sponsor the video series?'
        },
        {
          fingerprint: 'cedar-grant', targetScope: 'cedar_grants',
          summary: 'Cedar Grants award for Sidewalk Atlas',
          turnPrompt: 'Did Cedar Grants award a spring grant to Sidewalk Atlas?'
        }
      ]
      for (const matter of matters) {
        const lead = {
          ...matter, intentKey: 'confirm_outcome', why: 'I can check the final decision.',
          confidence: 0.9, sessionId: origin.id
        }
        repository.record({
          id: `lead-${matter.fingerprint}`, matterId: matter.fingerprint, sessionId: origin.id,
          summary: matter.summary, reason: lead.why, decision: PulseDecision.Save,
          findingKey: 'decision_pending', output: 'The decision is still pending.',
          checkedAt: new Date(now).toISOString()
        }, lead, { question: lead.turnPrompt, checkAt: now + DAY_MS, expiresAt: now + 2 * DAY_MS })
      }

      await runMaintainedTurn(context, 'What does tundra mean? Give a one-sentence definition.', workspace, ownerChat.id)
      for await (const usage of readInferenceUsage({ sessionId: ownerChat.id })) {
        assert.notEqual(usage.purpose, InferencePurpose.PulseReaction)
      }

      await runMaintainedTurn(context,
        'Northbank Media sounds interested in sponsoring my video series. We’re still waiting for their final decision. Please acknowledge briefly.',
        workspace, ownerChat.id
      )
      assert.equal(repository.openMatters(Date.now()).length, 2)

      const sponsorship = await runMaintainedTurn(context,
        'Northbank Media officially agreed to sponsor my video series. They signed the sponsorship agreement today. Please acknowledge briefly.',
        workspace, ownerChat.id
      )
      assert.deepEqual(repository.openMatters(Date.now()).map(({ lead }) => lead.fingerprint), ['cedar-grant'])

      const grant = await runMaintainedTurn(context,
        'Use Crawlberg to read the official Cedar Grants awards page at ' + SOURCE_URL + ' and tell me whether Sidewalk Atlas received a grant.',
        workspace, ownerChat.id
      )
      assert.equal(repository.openMatters(Date.now()).length, 0)

      const db = new SQLite(path.join(directory, 'pulse.sqlite'), { readonly: true })
      try {
        const resolutions = db.prepare(`
          SELECT matter_id, session_id, source_message_id FROM results
          WHERE decision = ? ORDER BY checked_at
        `).all(PulseDecision.ResolvedInChat)
        assert.deepEqual(resolutions, [
          { matter_id: 'northbank-sponsorship', session_id: ownerChat.id, source_message_id: sponsorship.responseTrace.id },
          { matter_id: 'cedar-grant', session_id: ownerChat.id, source_message_id: grant.responseTrace.id }
        ])

        return { resolvedMatters: resolutions.length }
      } finally {
        db.close()
      }
    })
  }
}

export default scenario
