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
  { environment: 'CI', ci: 'true', sendsReports: false },
  { environment: 'an owner installation', ci: 'false', sendsReports: true }
])('applies the sharing preference in $environment', async ({ ci, sendsReports }) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-telemetry-'))
  const profile = path.join(home, 'profiles', PROFILE)

  try {
    await fs.mkdir(profile, { recursive: true })
    await fs.writeFile(path.join(profile, 'config.yml'), 'telemetry_enabled: true\n')
    await fs.writeFile(path.join(home, 'leon.json'), JSON.stringify({ instanceID: 'fixture-installation' }))

    // Each child sets its environment before Core loads. Intercept outbound
    // requests to exercise the reporter without writing to the fleet.
    await execute(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { setTimeout as delay } from 'node:timers/promises'
      import { startProfileTelemetry } from './server/src/core/telemetry/profile-telemetry.ts'

      const reports = new Set()
      const delivery = Promise.withResolvers()
      globalThis.fetch = (url) => {
        reports.add(new URL(url).pathname)
        if (reports.has('/v1/presence') && reports.has('/v2/event')) {
          delivery.resolve()
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      }

      const stop = startProfileTelemetry()
      try {
        if (${sendsReports}) {
          await delivery.promise
          assert.deepEqual(reports, new Set(['/v1/presence', '/v2/event']))
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
