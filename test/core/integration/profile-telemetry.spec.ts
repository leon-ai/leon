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
  { environment: 'an owner installation with sharing enabled', ci: 'false', enabled: true, sendsReports: true },
  { environment: 'an owner installation using a legacy collector', ci: 'false', enabled: true, sendsReports: true, legacy: true }
])('applies the sharing preference in $environment', async ({ ci, enabled, sendsReports, legacy = false }) => {
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
      import { randomUUID } from 'node:crypto'
      import { setTimeout as delay } from 'node:timers/promises'
      import fs from 'node:fs/promises'
      import path from 'node:path'
      import SQLite from 'better-sqlite3'
      import { startProfileTelemetry } from './server/src/core/telemetry/profile-telemetry.ts'
      import { measurePulse, withPulseStage } from './server/src/core/telemetry/pulse-measurements.ts'
      import {
        DAILY_REPORT_PATH, getPublicModel, PRESENCE_INTERVAL_MS, PulseFailureCode, PulseFailureScope, PulseStage, TELEMETRY_DAY_MS
      } from './server/src/core/telemetry/report-contract.ts'
      import { TELEMETRY_COLLECTOR_ORIGIN } from './server/src/constants.ts'
      import { getProfilePaths } from './server/src/core/profile-runtime/profile-paths.ts'
      import PulseManager from './server/src/core/pulse-manager/pulse-manager.ts'
      import { PulseDecision, PulseResultRepository } from './server/src/core/pulse-manager/pulse-result-repository.ts'
      import PostTurnMaintenanceQueue from './server/src/core/turn-lifecycle/post-turn-maintenance-queue.ts'
      import { ConversationRepository } from './server/src/core/session-manager/conversation-repository.ts'
      import { runWithTurnClient } from './server/src/core/leon-interface/turn-client.ts'
      import { InferenceDiagnosticError } from './server/src/core/turn-lifecycle/observability/failure.ts'
      import { LogHelper } from './server/src/helpers/log-helper.ts'
      import {
        recordOwnerTurn, recordOwnerTurnError, recordTurnInference, runTurnPhase, runWithTurnTiming, TurnPhase, TurnStage
      } from './server/src/core/turn-lifecycle/observability/timing.ts'

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

      const pulseFolder = path.join(paths.context, 'private')
      const outcomes = new PulseResultRepository(pulseFolder)
      const lead = {
        fingerprint: 'fixture-lead', intentKey: 'fixture', targetScope: 'fixture', summary: 'fixture',
        why: 'fixture', turnPrompt: 'fixture', confidence: 1, sessionId: 'fixture-session'
      }
      outcomes.record({
        id: 'old-quiet-result', matterId: lead.fingerprint, sessionId: lead.sessionId, summary: 'fixture',
        reason: 'fixture', findingKey: null, decision: PulseDecision.Silent, output: null,
        checkedAt: new Date(daysAgo(31)).toISOString()
      }, lead, null)
      const db = new SQLite(path.join(pulseFolder, 'pulse.sqlite'))
      db.exec("CREATE TRIGGER fail_prune BEFORE DELETE ON results BEGIN SELECT RAISE(FAIL, 'private token in /private/owner.txt'); END")
      db.close()
      const pulse = new PulseManager()

      const reports = new Set()
      const events = new Map()
      const rejected = new Set()
      let failedTurn
      const delivery = Promise.withResolvers()
      globalThis.fetch = (url, options) => {
        const pathname = new URL(url).pathname
        reports.add(pathname)
        if (pathname === '/v2/event') {
          const event = JSON.parse(options.body)
          if (${legacy} && (event.counters?.tick_finished !== undefined ||
            event.turnDiagnostics?.some(({ diagnosticId }) => diagnosticId))) {
            rejected.add(event.id)
            return Promise.resolve(new Response(null, { status: 400 }))
          }
          if (event.kind === 'turn_finished' && event.report.failed) {
            failedTurn = event
          } else {
            events.set(event.kind, event)
          }
        }
        if (failedTurn && reports.has('/v1/presence') && ['profile_started', 'pulse_metrics', 'turn_finished', 'session_activity', 'maintenance_metrics']
          .every((kind) => events.has(kind))) {
          delivery.resolve()
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      const realSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay === PRESENCE_INTERVAL_MS ? 20 : delay, ...args)
      const stop = startProfileTelemetry()
      measurePulse({ counter: 'discovery_checked', count: 1 })
      measurePulse({ counter: 'discovery_checked', count: 2 })
      let inference
      withPulseStage(PulseStage.Research, () => {
        measurePulse({ stage: PulseStage.Research, usage: {
          provider: 'llamacpp', model: '/private/owner-model.gguf', outcome: 'completed', usage: { inputTokens: 50, outputTokens: 10 }
        } })
      }, (label) => {
        inference = label
      })
      for (const scope of [PulseFailureScope.Discovery, PulseFailureScope.Discovery, PulseFailureScope.FollowUp]) {
        measurePulse({ failure: { code: PulseFailureCode.ResearchBlocked, scope, inference } })
      }
      const example = randomUUID()
      for (const diagnosticId of [example, randomUUID()]) {
        measurePulse({ failure: {
          code: PulseFailureCode.PlanningInference, scope: PulseFailureScope.Tick, inference,
          diagnosticId, causeCode: 'connection_refused'
        } })
        measurePulse({ counter: 'tick_finished', count: 1 })
      }
      try {
        await pulse.tick('manual')
        await runWithTurnClient('mobile', 'ios', () => runWithTurnTiming('fixture-turn', 'fixture-session', async () => {
          runTurnPhase(TurnPhase.Execution, () => runTurnPhase(TurnPhase.Review, () => {
            recordTurnInference({
              attemptId: 'fixture-failed-attempt', outcome: 'failed', failureKind: 'unavailable',
              startedAt: now - 15, elapsedMs: 15, duty: 'react', provider: 'llamacpp', model: '/private/owner-model.gguf'
            }, Object.assign(new Error('private provider response'), { status: 429 }))
          }))
          recordOwnerTurn('answered')
        }))
        await runWithTurnTiming('failed-turn', 'fixture-session', async () => {
          try {
            await runTurnPhase(TurnPhase.Provider, async () => {
              throw new InferenceDiagnosticError('private boot error at /private/model.gguf', 'model_load', {
                inference: getPublicModel('llamacpp', '/private/owner-model.gguf')
              })
            })
          } catch (error) {
            recordOwnerTurnError(error)
          }
        })
        const queue = new PostTurnMaintenanceQueue()
        queue.enqueue('memory extraction', () => {
          throw Object.assign(new Error('private maintenance error'), { code: 'ETIMEDOUT' })
        })
        await queue.whenIdle()
        if (${sendsReports}) {
          const deadline = realSetTimeout(() => {
            delivery.reject(new Error('Missing telemetry reports: ' + [...events.keys()].join(', ')))
          }, 2_000)
          try {
            await delivery.promise
          } finally {
            clearTimeout(deadline)
          }
          assert.deepEqual(reports, new Set(['/v1/presence', '/v2/event']))
          assert.deepEqual(events.get('pulse_metrics').counters, {
            discovery_checked: 3, discovery_failed: 2, followup_failed: 1, tick_failed: 3,
            ...(${legacy} ? {} : { tick_finished: 3 })
          })
          const pulseFailures = events.get('pulse_metrics').failures
          const agenda = pulseFailures.find(({ code }) => code === 'tick_agenda_unavailable')
          assert.deepEqual(pulseFailures.filter(({ code }) => code !== 'tick_agenda_unavailable'), [
            { code: 'research_blocked', scope: 'discovery', count: 2, inference: { provider: 'llamacpp', model: 'other' } },
            { code: 'research_blocked', scope: 'followup', count: 1, inference: { provider: 'llamacpp', model: 'other' } },
            {
              code: 'planning_inference_incomplete', scope: 'tick', count: 2, inference: { provider: 'llamacpp', model: 'other' },
              ...(${legacy} ? {} : { diagnosticId: example, causeCode: 'connection_refused' })
            }
          ])
          assert.equal(agenda.count, 1)
          assert.equal(failedTurn.report.failed, 1)
          const [failure] = failedTurn.turnDiagnostics
          assert.equal(failure.phase, 'provider-resolution')
          assert.equal(failure.code, ${legacy} ? 'provider_error' : 'model_load')
          assert.equal(JSON.stringify(failedTurn).includes('/private/'), false)
          if (${legacy}) {
            assert.ok(rejected.has(failedTurn.id) && rejected.has(events.get('pulse_metrics').id))
            assert.equal(failure.diagnosticId, undefined)
            assert.equal(agenda.diagnosticId, undefined)
          } else {
            assert.deepEqual(failure.inference, { provider: 'llamacpp', model: 'other' })
            const log = await fs.readFile(LogHelper.ERRORS_FILE_PATH, 'utf8')
            assert.ok(log.split('\\n').some((line) => line.includes(failure.diagnosticId) && line.includes('private boot error')))
            assert.ok(log.split('\\n').some((line) => line.includes(agenda.diagnosticId) && line.includes('private token')))
          }
          assert.equal(events.get('pulse_metrics').os, process.platform)
          assert.equal(JSON.stringify(events.get('pulse_metrics')).includes('/private/'), false)
          assert.equal(events.get('pulse_metrics').profile, events.get('profile_started').report.profile)
          assert.deepEqual(events.get('turn_finished').client, { type: 'mobile', os: 'ios' })
          assert.equal(events.get('turn_finished').report.fleet.os, process.platform)
          assert.equal(events.get('turn_finished').report.answered, 1)
          assert.deepEqual(events.get('turn_finished').turnDiagnostics, [{
            kind: 'attempt', phase: 'review', code: 'rate_limit', count: 1,
            inference: { provider: 'llamacpp', model: 'other' }
          }])
          assert.deepEqual(events.get('maintenance_metrics').tasks, [{
            stage: 'post-turn', task: 'memory extraction', outcome: 'failed', reason: 'timeout', count: 1
          }])
          assert.equal(JSON.stringify([...events.values()]).includes('private maintenance error'), false)
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
