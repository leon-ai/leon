import assert from 'node:assert/strict'

export const QUICK_EVAL_BRANCH = 'eval-history'
export const QUICK_EVAL_ASSET = 'leon-quick-evals.json'
export const QUICK_EVAL_SCHEMA = 1
export const QUICK_EVAL_MAX_BYTES = 1_048_576
export const QUICK_EVAL_SHA = /^[a-f0-9]{40}$/
export const QUICK_EVAL_RUN_ID = /^[1-9][0-9]{0,15}$/
export const QUICK_EVAL_ARCHIVE_PATH = /^quick-evals\/([a-f0-9]{40})\/([1-9][0-9]{0,15})-([1-9][0-9]{0,15})\.json$/
export const QUICK_EVAL_INDEX = 'quick-evals/index.json'
export const QUICK_EVAL_INDEX_LIMIT = 8 * 1_024 * 1_024
export const QUICK_EVAL_INDEX_URL = `https://raw.githubusercontent.com/leon-ai/leon/refs/heads/${QUICK_EVAL_BRANCH}/${QUICK_EVAL_INDEX}`

const METRICS = [
  'inputTokens', 'outputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'peakInputTokens',
  'modelCalls', 'failedCalls', 'foregroundInputTokens', 'maintenanceInputTokens', 'turnLatencyMs'
]

function measurements(value) {
  return Object.fromEntries(METRICS.map((key) => {
    const number = value[key]
    assert(Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER, 'Invalid evaluation measurement')
    return [key, number]
  }))
}

/**
 * Selects the public fields from a CI report. Diagnostic text and per-turn
 * detail belong to the workflow artifact, which can be inspected by maintainers.
 */
export function publicQuickEvalReport(report, provenance) {
  const { sha, version, recordedAt, committedAt, durationMs, suiteRevision, model, reasoning, results } = report
  const { runId, attempt, source } = provenance

  assert(QUICK_EVAL_SHA.test(sha) && /^[a-f0-9]{64}$/.test(suiteRevision), 'Invalid evaluation revision')
  assert(typeof version === 'string' && version.length > 0 && version.length <= 80, 'Invalid Leon version')
  assert(Number.isSafeInteger(recordedAt) && recordedAt > 0 && recordedAt <= 8_640_000_000_000_000, 'Invalid evaluation date')
  assert(committedAt === undefined ||
    Number.isSafeInteger(committedAt) && committedAt > 0 && committedAt <= 8_640_000_000_000_000, 'Invalid commit date')
  assert(Number.isSafeInteger(durationMs) && durationMs >= 0, 'Invalid evaluation duration')
  assert(typeof runId === 'string' && QUICK_EVAL_RUN_ID.test(runId) && Number.isSafeInteger(attempt) && attempt > 0,
    'Invalid evaluation run')
  assert(source === 'development' || source === 'release', 'Invalid evaluation source')
  assert(typeof model === 'string' && model.length > 0 && model.length <= 256, 'Invalid evaluation model')
  assert(typeof reasoning === 'string' && reasoning.length > 0 && reasoning.length <= 80, 'Invalid evaluation reasoning')
  assert(Array.isArray(results) && results.length > 0 && results.length <= 100, 'Invalid evaluation results')

  return {
    schemaVersion: QUICK_EVAL_SCHEMA, sha, version, recordedAt, durationMs, suiteRevision, model, reasoning, runId, attempt, source,
    ...(committedAt !== undefined ? { committedAt } : {}),
    results: results.map(({ scenario, status, baseline, measured, samples }) => {
      assert(typeof scenario === 'string' && /^[a-z0-9-]{1,256}$/.test(scenario), 'Invalid evaluation scenario')
      assert(['Passed', 'Warning', 'Failed'].includes(status), 'Invalid evaluation result')
      assert(Array.isArray(samples) && samples.length <= 100, 'Invalid evaluation samples')
      return {
        scenario, status, ...(baseline ? { baseline: measurements(baseline) } : {}),
        ...(measured ? { measured: measurements(measured) } : {}),
        samples: samples.map((sample) => ({ metrics: measurements(sample.metrics) }))
      }
    })
  }
}

/**
 * Projects an archived report to the fields needed to compare its scenarios.
 */
export function summarizeQuickEvalReport(report) {
  const { sha, version, recordedAt, committedAt, durationMs, suiteRevision, model, reasoning, runId, attempt, source } = report
  return {
    id: `${sha}/${runId}-${attempt}`, sha, version, recordedAt, durationMs, suiteRevision, model, reasoning, runId, attempt, source,
    ...(committedAt !== undefined ? { committedAt } : {}),
    cases: report.results.map(({ scenario, status, baseline, measured, samples }) => ({
      scenario, status, baseline: baseline ?? null, measured: measured ?? samples.at(-1)?.metrics ?? null, samples: samples.length
    }))
  }
}
