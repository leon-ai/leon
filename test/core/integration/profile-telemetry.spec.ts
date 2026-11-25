import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { it } from 'vitest'

const execute = promisify(execFile)
const PROFILE = 'telemetry-fixture'
const REPORTER_TIMEOUT_MS = 10_000

it.each([
  { environment: 'CI', ci: 'true', enabled: true, sendsReports: false },
  { environment: 'an owner installation with sharing disabled', ci: 'false', enabled: false, sendsReports: false },
  { environment: 'an owner installation with sharing enabled', ci: 'false', enabled: true, sendsReports: true }
])('applies the sharing preference in $environment', async ({ ci, enabled, sendsReports }) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-telemetry-'))
  const profile = path.join(home, 'profiles', PROFILE)

  try {
    await fs.mkdir(profile, { recursive: true })
    await fs.writeFile(path.join(profile, 'config.yml'), `telemetry_enabled: ${enabled}\n`)
    await fs.writeFile(path.join(home, 'leon.json'), JSON.stringify({ instanceID: 'fixture-installation' }))

    // Each child sets its environment before the server loads. Intercept outbound
    // requests to exercise the reporter without writing to the fleet.
    await execute(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { setTimeout as delay } from 'node:timers/promises'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      import { startProfileTelemetry } from './server/src/core/telemetry/profile-telemetry.ts'
      import { measurePulse } from './server/src/core/telemetry/pulse-measurements.ts'
      import { DAILY_REPORT_PATH, PulseStage, TELEMETRY_DAY_MS } from './server/src/core/telemetry/report-contract.ts'
      import { TELEMETRY_COLLECTOR_ORIGIN } from './server/src/constants.ts'
      import { getProfilePaths } from './server/src/core/profile-runtime/profile-paths.ts'
      import { ConversationRepository } from './server/src/core/session-manager/conversation-repository.ts'
      import { runWithTurnClient } from './server/src/core/leon-interface/turn-client.ts'
      import { recordOwnerTurn, runWithTurnTiming, TurnPhase, TurnStage } from './server/src/core/llm-manager/turn-timing.ts'

      const now = Date.UTC(2030, 0, 31, 12)
      Date.now = () => now
      const paths = getProfilePaths()
      const today = Math.floor(now / TELEMETRY_DAY_MS) * TELEMETRY_DAY_MS
      const daysAgo = (days) => today - days * TELEMETRY_DAY_MS + 1_000
      const enabledAt = daysAgo(20)
      await fs.writeFile(path.join(paths.root, 'telemetry-state.json'), JSON.stringify({
        enabledAt, firstReportingAt: enabledAt, seed: 'sharing-test-seed',
        endpoint: new URL(DAILY_REPORT_PATH, TELEMETRY_COLLECTOR_ORIGIN).href
      }))
      const archive = new ConversationRepository(paths.sessions)
      const workspace = archive.workspaces.create({ name: 'private-workspace', brief: '', resources: [] })
      for (const [id, createdAt, workspaceId] of [
        ['private-repeat', daysAgo(15), workspace.id],
        ['private-one-turn', daysAgo(15)],
        ['private-empty', daysAgo(3)],
        ['private-before-sharing', daysAgo(22)],
        ['private-deleted', daysAgo(3)]
      ]) {
        archive.saveSession({
          id, createdAt, workspaceId, title: id, updatedAt: createdAt, isPinned: false,
          isTitleGenerated: false, lastMessageAt: null, messageCount: 0, modelTarget: null
        })
      }
      archive.deleteSession('private-deleted')
      archive.close()
      const journal = path.join(paths.logs, 'turns')
      await fs.mkdir(journal, { recursive: true })
      for (const [sessionId, day, stages] of [
        ['private-repeat', 13, [TurnStage.PreTurn, TurnStage.PostTurn]],
        ['private-repeat', 12, [TurnStage.PreTurn]],
        ['private-one-turn', 13, [TurnStage.PreTurn]],
        ['private-one-turn', 4, [TurnStage.PreTurn]],
        ['private-deleted', 3, [TurnStage.PreTurn]],
        ['private-before-sharing', 21, [TurnStage.PreTurn]]
      ]) {
        const startedAt = daysAgo(day)
        const date = new Date(startedAt).toISOString().slice(0, 10)
        const records = stages.map((stage) => JSON.stringify({
          sessionId, turnId: [sessionId, day, stage].join('/'), startedAt,
          goal: TurnPhase.Turn, stage, ownerTurn: { outcome: 'answered' }
        }))
        await fs.appendFile(path.join(journal, date + '.jsonl'), records.join('\\n') + '\\n')
      }

      const reports = new Set()
      const events = new Map()
      const delivery = Promise.withResolvers()
      globalThis.fetch = (url, options) => {
        const pathname = new URL(url).pathname
        reports.add(pathname)
        if (pathname === '/v2/event') {
          const event = JSON.parse(options.body)
          events.set(event.kind, event)
        }
        if (reports.has('/v1/presence') && ['profile_started', 'pulse_metrics', 'turn_finished', 'session_activity']
          .every((kind) => events.has(kind))) {
          delivery.resolve()
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      const stop = startProfileTelemetry()
      measurePulse({ counter: 'discovery_checked', count: 1 })
      measurePulse({ counter: 'discovery_checked', count: 2 })
      measurePulse({ stage: PulseStage.Research, usage: {
        provider: 'llamacpp', model: '/private/owner-model.gguf', outcome: 'completed', usage: { inputTokens: 50, outputTokens: 10 }
      } })
      try {
        await runWithTurnClient('mobile', 'ios', () => runWithTurnTiming('fixture-turn', 'fixture-session', async () => {
          recordOwnerTurn('answered')
        }))
        if (${sendsReports}) {
          await delivery.promise
          assert.deepEqual(reports, new Set(['/v1/presence', '/v2/event']))
          assert.deepEqual(events.get('pulse_metrics').counters, { discovery_checked: 3 })
          assert.equal(events.get('pulse_metrics').profile, events.get('profile_started').report.profile)
          assert.deepEqual(events.get('turn_finished').client, { type: 'mobile', os: 'ios' })
          assert.equal(events.get('turn_finished').report.fleet.os, process.platform)
          assert.equal(events.get('profile_started').client, undefined)
          const sessionActivity = events.get('session_activity')
          assert.equal(sessionActivity.profile, events.get('profile_started').report.profile)
          assert.deepEqual(sessionActivity.activity, {
            savedWorkspaces: 1, savedSessions: 4, workspaceSessions: 1, activeWorkspaces: 1,
            activeSessions: 2, returningSessions: 2, turnsPerSession: [0, 2, 0, 0, 0],
            continuation: { eligibleSessions: 2, continuedSessions: 1 }
          })
          assert.equal(JSON.stringify(sessionActivity).includes('private-'), false)
          assert.deepEqual(events.get('pulse_metrics').usage, [{
            provider: 'llamacpp', model: 'other', stage: 'research', calls: 1, failedCalls: 0,
            inputTokens: 50, outputTokens: 10, cachedInputTokens: 0, cacheReportedCalls: 0, costMicros: 0, costSamples: 0
          }])
        } else {
          await delay(100)
          assert.equal(reports.size, 0)
        }
      } finally {
        stop?.()
      }
    `], { env: { ...process.env, CI: ci, LEON_HOME: home, LEON_PROFILE: PROFILE }, timeout: REPORTER_TIMEOUT_MS })
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})
