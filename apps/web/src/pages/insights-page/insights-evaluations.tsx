import { useState } from 'react'

import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { useInsightsEvaluations } from '@/data/insights'
import { INSIGHTS_RANGES, EVALUATION_STATUSES, EVALUATION_UNKNOWN_SUITE, type EvaluationMetrics, type EvaluationQuery }
  from '../../../../../server/src/core/insights/insights-contract'

import { INSIGHTS_DATE, InsightsChart } from './insights-charts'

const SOURCE_LABELS = { development: 'Development', release: 'Published releases', local: 'Local files' } as const

function suiteLabel(suite: string): string {
  return suite === EVALUATION_UNKNOWN_SUITE ? 'Unrecorded' : suite.slice(0, 12)
}

/**
 * Displays the selected suite or scenario and pages through its checkpoints.
 */
export default function InsightsEvaluations() {
  const [filters, setFilters] = useState<EvaluationQuery>({})
  const { data, isFetching, isPending, isError } = useInsightsEvaluations(filters)
  const points = data?.points ?? []
  const scenario = data?.scenario
  const runsPerCommit = new Map<string, number>()
  for (const { sha } of points) {
    runsPerCommit.set(sha, (runsPerCommit.get(sha) ?? 0) + 1)
  }
  const commitRuns = new Map<string, number>()
  const labels = points.map(({ sha }) => {
    const number = (commitRuns.get(sha) ?? 0) + 1
    commitRuns.set(sha, number)
    return (runsPerCommit.get(sha) ?? 0) > 1 ? `${sha.slice(0, 12)} · ${number}` : sha.slice(0, 12)
  })
  const details = points.map((point, index) =>
    `${INSIGHTS_DATE.format(point.date)} · ${labels[index]} · Suite ${suiteLabel(point.suite)} · ${point.model} / ${point.reasoning}`)
  const mixedSettings = new Set(points.map(({ suite, model, reasoning }) => JSON.stringify([suite, model, reasoning]))).size > 1
  const series = (label: string, key: keyof EvaluationMetrics, baseline = false) => ({
    label, previous: baseline, values: points.map((point) => {
      const metrics = baseline ? point.baseline : point.measured
      const value = metrics?.[key]
      if (value === undefined) {
        return null
      }
      return key === 'turnLatencyMs' ? value / 1_000 : value
    })
  })

  return <div className="insights-panel" aria-busy={isFetching}>
    <p className="insights-note">Each point is one evaluation run in commit order. All scenarios shows usage totals, highest input peak, and median scenario duration.</p>
    {mixedSettings && <p className="insights-note">These runs use different evaluation settings. Filter by model, reasoning, or suite revision to compare like for like.</p>}
    {isPending && <Loader size="md" label="Loading evaluations…" />}
    {(isError || data?.refreshFailed) && <p className="insights-note" role="status">
      {data?.rows.length ? 'I couldn’t check for new evaluations. Showing saved results.' : 'I couldn’t load evaluations from GitHub.'}
    </p>}
    {data && <>
      <div className="insights-filters">
        <label>Source
          <select value={filters.source ?? ''} onChange={(event) => {
            const source = event.currentTarget.value as EvaluationQuery['source'] | ''
            setFilters({ days: filters.days, source: source || undefined })
          }}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {data.models.length > 0 && <>
          <label>Evaluation model
            <select value={data.model} onChange={(event) => setFilters({
              days: filters.days, source: filters.source, model: event.currentTarget.value || undefined
            })}>
              <option value="">All models</option>
              {data.models.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Reasoning
            <select value={data.reasoning} onChange={(event) => setFilters({
              days: filters.days, source: filters.source, model: filters.model,
              reasoning: event.currentTarget.value || undefined
            })}>
              <option value="">All reasoning levels</option>
              {data.reasons.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Scenario
            <select value={data.scenario} onChange={(event) => setFilters({ ...filters, scenario: event.currentTarget.value || undefined, page: undefined })}>
              <option value="">All scenarios</option>
              {data.scenarios.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Suite revision
            <select value={data.suite} onChange={(event) => setFilters({
              ...filters, suite: event.currentTarget.value || undefined, scenario: undefined, page: undefined
            })}>
              <option value="">All suite revisions</option>
              {data.suites.map((item) => <option key={item} value={item}>{suiteLabel(item)}</option>)}
            </select>
          </label>
        </>}
        <label>Commit date range
          <select value={filters.days ?? ''} onChange={(event) => {
            setFilters({ ...filters, days: Number(event.currentTarget.value) || undefined, page: undefined })
          }}>
            <option value="">All time</option>
            {INSIGHTS_RANGES.map((days) => <option key={days} value={days}>Last {days} days</option>)}
          </select>
        </label>
      </div>
      {points.length === 0 ? <p>No evaluations match these filters.</p> : <>
        <div className="insights-chart-grid">
          <InsightsChart title="Evaluation outcomes" kind="bar" stacked labels={labels} details={details} series={EVALUATION_STATUSES.map((label) => ({
            label, values: points.map(({ outcomes }) => outcomes[label])
          }))} />
          <InsightsChart title="Evaluation token usage" labels={labels} details={details} series={[
            series('Input', 'inputTokens'), series('Baseline input', 'inputTokens', true),
            series('Output', 'outputTokens'), series('Peak input', 'peakInputTokens')
          ]} />
          <InsightsChart title="Evaluation cache usage" labels={labels} details={details} kind="bar" stacked series={[
            series('Cached input', 'cachedInputTokens'), series('Uncached input', 'uncachedInputTokens')
          ]} />
          <InsightsChart title="Evaluation model calls" labels={labels} details={details} series={[
            series('Model calls', 'modelCalls'), series('Baseline calls', 'modelCalls', true),
            series('Failed calls', 'failedCalls')
          ]} />
          <InsightsChart title="Evaluation latency" unit=" s" labels={labels} details={details} series={[
            series(scenario ? 'Scenario duration' : 'Median scenario duration', 'turnLatencyMs'),
            series(scenario ? 'Baseline duration' : 'Baseline median', 'turnLatencyMs', true)
          ]} />
          <InsightsChart title="Foreground and maintenance input" labels={labels} details={details} kind="bar" stacked series={[
            series('Foreground', 'foregroundInputTokens'),
            series('Maintenance', 'maintenanceInputTokens')
          ]} />
        </div>
        <div className="insights-table-scroll">
          <table aria-label="Evaluation runs">
            <thead><tr><th scope="col">Commit date</th><th scope="col">Commit</th><th scope="col">Source</th><th scope="col">Suite revision</th>
              <th scope="col">Result</th><th scope="col">Samples</th></tr></thead>
            <tbody>{data.rows.map((run) => <tr key={run.id}>
              <th scope="row" title={`Evaluated ${INSIGHTS_DATE.format(run.recordedAt)}`}>
                {INSIGHTS_DATE.format(run.committedAt ?? run.recordedAt)}{run.committedAt === undefined && <small>Run date</small>}
              </th>
              <td><code title={run.sha}>{run.sha.slice(0, 12)}</code></td>
              <td>{run.source === 'release' && run.version ? `Leon ${run.version}` : SOURCE_LABELS[run.source ?? 'local']}
                {run.runUrl && <small><a href={run.runUrl} target="_blank" rel="noreferrer">CI run {run.runId}</a></small>}
              </td>
              <td><code title={run.suiteRevision}>{suiteLabel(run.suiteRevision ?? EVALUATION_UNKNOWN_SUITE)}</code></td>
              <td>{EVALUATION_STATUSES.flatMap((status) => run.outcomes[status]
                ? [scenario ? status : `${run.outcomes[status]} ${status.toLowerCase()}`] : []).join(' · ')}</td>
              <td>{run.samples}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {data.pages > 1 && <div className="insights-filters" role="group" aria-label="Evaluation run pages">
          <Button size="sm" disabled={isFetching || data.page === 0}
            onClick={() => setFilters({ ...filters, page: data.page - 1 })}>Previous page</Button>
          <span>Page {data.page + 1} of {data.pages}</span>
          <Button size="sm" disabled={isFetching || data.page + 1 === data.pages}
            onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next page</Button>
        </div>}
      </>}
    </>}
  </div>
}
