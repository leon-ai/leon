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

    // Each child sets its environment before Core loads. Intercept outbound
    // requests to exercise the reporter without writing to the fleet.
    await execute(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { setTimeout as delay } from 'node:timers/promises'
      import { startProfileTelemetry } from './server/src/core/telemetry/profile-telemetry.ts'
      import { measurePulse } from './server/src/core/telemetry/pulse-measurements.ts'
      import { PulseStage } from './server/src/core/telemetry/report-contract.ts'

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
        if (reports.has('/v1/presence') && events.has('profile_started') && events.has('pulse_metrics')) {
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
        if (${sendsReports}) {
          await delivery.promise
          assert.deepEqual(reports, new Set(['/v1/presence', '/v2/event']))
          assert.deepEqual(events.get('pulse_metrics').counters, { discovery_checked: 3 })
          assert.equal(events.get('pulse_metrics').profile, events.get('profile_started').report.profile)
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
