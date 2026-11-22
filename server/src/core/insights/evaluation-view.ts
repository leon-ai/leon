import type { EvaluationRun, EvaluationHistoryView, EvaluationMetrics, EvaluationQuery } from './insights-contract'

const RUNS_PER_PAGE = 25
const DAY_MS = 86_400_000
const UNKNOWN_SUITE = 'unrecorded'
type Case = EvaluationRun['cases'][number]
type CaseSummary = Pick<EvaluationHistoryView['points'][number], 'outcomes' | 'baseline' | 'measured'> & { samples: number }

function aggregateMetrics(cases: Case[], field: 'baseline' | 'measured'): EvaluationMetrics | null {
  const first = cases[0]?.[field]
  if (!first || cases.some((result) => result[field] === null)) {
    return null
  }

  const keys = Object.keys(first) as (keyof EvaluationMetrics)[]
  const totals = { ...first }
  const durations = [first.turnLatencyMs]
  let peakInput = first.peakInputTokens
  for (const entry of cases.slice(1)) {
    const metrics = entry[field]!
    for (const key of keys) {
      totals[key] += metrics[key]
    }
    peakInput = Math.max(peakInput, metrics.peakInputTokens)
    durations.push(metrics.turnLatencyMs)
  }

  durations.sort((left, right) => left - right)
  totals.peakInputTokens = peakInput
  totals.turnLatencyMs = (durations[Math.floor((durations.length - 1) / 2)]! + durations[Math.floor(durations.length / 2)]!) / 2
  return totals
}

function summarize(cases: Case[]): CaseSummary {
  const outcomes = { Passed: 0, Warning: 0, Failed: 0 }
  let samples = 0
  for (const entry of cases) {
    outcomes[entry.status]++
    samples += entry.samples
  }

  return { outcomes, samples, baseline: aggregateMetrics(cases, 'baseline'), measured: aggregateMetrics(cases, 'measured') }
}

// Public runs reuse the case arrays in the shared index until its ETag changes.
const summaries = new WeakMap<Case[], CaseSummary>()

function option(values: string[], selected?: string): string {
  return selected && values.includes(selected) ? selected : values[0] ?? ''
}

/**
 * Projects the selected benchmark series and one page of run metadata.
 */
export function projectEvaluationHistory(
  history: EvaluationRun[], query: EvaluationQuery, refreshFailed = false
): EvaluationHistoryView {
  const runs = query.source ? history.filter((run) => (run.source ?? 'local') === query.source) : history
  const models = [...new Set(runs.map((run) => run.model))]
  const model = option(models, query.model)
  const reasons = [...new Set(runs.filter((run) => run.model === model).map((run) => run.reasoning))]
  const reasoning = option(reasons, query.reasoning)
  const matchedModel = runs.filter((run) => run.model === model && run.reasoning === reasoning)
  const suites = [...new Set(matchedModel.map((run) => run.suiteRevision ?? UNKNOWN_SUITE))]
  const suite = option(suites, query.suite)
  const comparable = matchedModel.filter((run) => (run.suiteRevision ?? UNKNOWN_SUITE) === suite)
  const scenarios = [...new Set(comparable.flatMap((run) => run.cases.map((entry) => entry.scenario)))]
  const scenario = query.scenario && scenarios.includes(query.scenario) ? query.scenario : ''
  const cutoff = query.days === undefined ? 0 : Date.now() - query.days * DAY_MS
  const selected = comparable.flatMap((run) => {
    const date = run.committedAt ?? run.recordedAt
    if (date < cutoff) {
      return []
    }
    if (scenario) {
      const entry = run.cases.find((candidate) => candidate.scenario === scenario)
      return entry ? [{ run, date, summary: summarize([entry]) }] : []
    }

    let summary = summaries.get(run.cases)
    if (!summary) {
      summary = summarize(run.cases)
      summaries.set(run.cases, summary)
    }
    return [{ run, date, summary }]
  }).sort((left, right) => right.date - left.date || right.run.recordedAt - left.run.recordedAt)

  const pages = Math.max(1, Math.ceil(selected.length / RUNS_PER_PAGE))
  const page = Math.min(query.page ?? 0, pages - 1)
  const points = selected.toReversed().map(({ run, date, summary: { baseline, measured, outcomes } }) => ({
    sha: run.sha, date, baseline, measured, outcomes
  }))
  const rows = selected.slice(page * RUNS_PER_PAGE, (page + 1) * RUNS_PER_PAGE).map(({
    run: { id, sha, recordedAt, committedAt, source, version, runId, runUrl }, summary: { outcomes, samples }
  }) => ({
    id, sha, recordedAt, outcomes, samples,
    ...(committedAt !== undefined ? { committedAt } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(runId !== undefined ? { runId } : {}),
    ...(runUrl !== undefined ? { runUrl } : {})
  }))

  return { models, reasons, suites, scenarios, model, reasoning, suite, scenario, page, pages, refreshFailed, points, rows }
}
