import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, scenarioWeather } from './scenario-fixture'

export enum OwnerInterruption {
  Cancel = 'cancel',
  Change = 'change'
}

/**
 * Deliver owner input at a real tool boundary through the session's live queue.
 */
export function createOwnerInterruptionScenario(mode: OwnerInterruption): RealAgentScenario {
  let interrupt: (() => void) | undefined

  return {
    toolResult(input): ReturnType<typeof scenarioWeather> {
      const result = scenarioWeather(input)
      if (result) {
        interrupt?.()
      }
      return result
    },
    async run(context): Promise<Record<string, unknown>> {
      return inScenarioWorkspace(context.profilePath, async (workspace) => {
        const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
        const { CONVERSATION_LOGGER } = await import('@/core')
        const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
        const update = mode === OwnerInterruption.Cancel
          ? 'Stop. Cancel this task now; do not create any report.'
          : 'Change the city to Oslo, Norway. Save the weather report as oslo.txt instead. Continue with that correction.'
        let consumed: Promise<boolean> | null = null

        interrupt = (): void => {
          if (consumed || !CONVERSATION_SESSION_MANAGER.isAgentTurnActive(sessionId)) {
            return
          }
          // Do not await consumption inside the running tool: the loop drains
          // this input after the current batch has settled.
          consumed = CONVERSATION_SESSION_MANAGER.queueAgentMessage(sessionId, async () => {
            await CONVERSATION_LOGGER.upsert({
              who: 'owner', message: update, messageId: randomUUID(), isAddedToHistory: true
            }, { sessionId })
            return { role: 'user', content: update }
          })
        }

        try {
          const turn = await context.runTurn('Get current weather in London, UK using the weather tool, then write the observed city and temperature to london.txt in this workspace. Verify the file.', sessionId)
          assert.ok(consumed, 'The owner update must arrive while the agent is active.')
          assert.equal(await consumed, true)
          assert.equal(await fs.stat(path.join(workspace, 'london.txt')).then(() => true, () => false), false)
          if (mode === OwnerInterruption.Cancel) {
            assert.equal(turn.finalIntent, 'cancelled', JSON.stringify(turn))
            assert.equal((await fs.readdir(workspace)).filter((name) => name.endsWith('.txt')).length, 0)
          } else {
            assert.equal(turn.finalIntent, 'answer', JSON.stringify(turn))
            const report = await fs.readFile(path.join(workspace, 'oslo.txt'), 'utf8')
            assert.ok(report.includes('Oslo') && report.includes('18'))
            assert.ok(turn.executionHistory.some((execution) => execution.function === 'weather.openmeteo.getWeather' &&
              execution.requestedToolInput?.includes('Oslo')))
          }

          return { turn, update }
        } finally {
          interrupt = undefined
        }
      })
    }
  }
}
