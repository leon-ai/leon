import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { ROOT, ARTIFACTS, launchDiagnostic, swiftHelper } from './native.mjs'
import { createFixture } from '../test/fixture.mjs'

const { values } = parseArgs({ options: { runs: { type: 'string', default: '3' }, page: { type: 'string', default: 'all' } } })
assert.equal(process.platform, 'darwin', 'Native footprint sampling currently requires macOS')
const runs = Number(values.runs)
assert(Number.isInteger(runs) && runs > 0 && runs <= 10, '--runs must be between 1 and 10')
assert(['all', 'home', 'history', 'active'].includes(values.page), 'Unknown performance page')
const execute = promisify(execFile)
const helper = await swiftHelper('sample-macos')
const snapshot = async (pid) => JSON.parse((await execute(helper, [String(pid)])).stdout)
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)]
const results = {}
const pages = values.page === 'all' ? ['home', 'history', 'active'] : [values.page]

for (const page of pages) {
  const trials = []
  for (let run = 0; run < runs; run += 1) {
    const tokens = Array.from({ length: 400 }, (_, index) => `stream-${index} `)
    const fixture = await createFixture({ historyTurns: 240, streamTokens: tokens })
    let app
    try {
      app = await launchDiagnostic({ name: `performance-${page}-${run}`, script: 'performance.js', server: fixture.origin,
        nativeThrottling: page !== 'active', configuration: { page, scroll_steps: 120, interaction_ms: 60,
          paint_when_hidden: page === 'active', expected_answer: tokens.join('') } })
      await app.wait(page === 'active' ? 'workload' : 'idle')
      if (page !== 'active') {
        await delay(5_000)
      }
      const before = await snapshot(app.pid)
      const started = performance.now()
      let current = before
      let peak = before.physical_footprint_bytes
      let check
      while (performance.now() - started < 60_000) {
        await delay(250)
        current = await snapshot(app.pid)
        peak = Math.max(peak, current.physical_footprint_bytes)
        check = JSON.parse(await readFile(app.report, 'utf8'))
        assert(check.passed, JSON.stringify(check))
        if (page === 'active' ? check.phase === 'complete' : performance.now() - started >= 5_000) {
          break
        }
      }
      if (page === 'active') {
        assert.equal(check.phase, 'complete', 'The measured workload must complete')
      }
      const seconds = (performance.now() - started) / 1_000
      const previous = new Map(before.processes.map((item) => [item.pid, item.cpu_ns]))
      const cpu = current.processes.reduce((sum, item) => sum + Math.max(0, item.cpu_ns - (previous.get(item.pid) ?? item.cpu_ns)), 0)
      const trial = { seconds, mean_cpu_percent: cpu / seconds / 1e7, sampled_peak_footprint_mib: peak / 1_024 ** 2, checks: check }
      trials.push(trial)
      console.log(`${page} ${run + 1}: ${trial.mean_cpu_percent.toFixed(2)}% CPU, ${trial.sampled_peak_footprint_mib.toFixed(1)} MiB`)
    } finally {
      await app?.close()
      await fixture.close()
    }
  }
  results[page] = { trials, median_cpu_percent: median(trials.map((trial) => trial.mean_cpu_percent)),
    median_sampled_peak_mib: median(trials.map((trial) => trial.sampled_peak_footprint_mib)) }
}
const build = JSON.parse(await readFile(path.join(ARTIFACTS, 'diagnostics-build.json'), 'utf8'))
const report = { version: build.version, electron: build.electron, platform: os.release(),
  entry_sha256: createHash('sha256').update(await readFile(path.join(ROOT, '../web/dist/index.html'))).digest('hex'),
  native_window_hidden: true, idle_native_throttling: true, active_paint_control: true,
  active_document_visibility: 'visible', core_and_models_excluded: true, results }
await writeFile(path.join(ARTIFACTS, 'performance.json'), JSON.stringify(report, null, 2) + '\n')
