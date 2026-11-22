import { useState } from 'react'

import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { useInsightsEvaluations } from '@/data/insights'
import { INSIGHTS_RANGES, EVALUATION_STATUSES, type EvaluationMetrics, type EvaluationQuery }
  from '../../../../../server/src/core/insights/insights-contract'

import { INSIGHTS_DATE, InsightsChart } from './insights-charts'

const SOURCE_LABELS = { development: 'Development', release: 'Published releases', local: 'Local files' } as const
const UNKNOWN_SUITE = 'unrecorded'

/**
 * Displays the selected suite or scenario and pages through its checkpoints.
 */
export default function InsightsEvaluations() {
  const [filters, setFilters] = useState<EvaluationQuery>({})
  const { data, isFetching, isPending, isError } = useInsightsEvaluations(filters)
  const points = data?.points ?? []
  const scenario = data?.scenario
  const labels = points.map(({ date }) => INSIGHTS_DATE.format(date))
  const details = points.map(({ sha }, index) => `${labels[index]} · ${sha.slice(0, 12)}`)
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
    <p className="insights-note">Compare commits with matching model, reasoning, and suite settings. The suite view shows usage totals, highest input peak, and median scenario duration.</p>
    {isPending && <Loader size="md" label="Loading evaluations…" />}
    {(isError || data?.refreshFailed) && <p className="insights-note" role="status">
      {data?.rows.length ? 'I couldn’t check for new evaluations. Showing saved results.' : 'I couldn’t load evaluations from GitHub.'}
    </p>}
    {data && <>
      <div className="insights-filters">
        <label>Source
          <select value={filters.source ?? ''} onChange={(event) => {
            const source = event.currentTarget.value as EvaluationQuery['source'] | ''
            setFilters({ ...filters, source: source || undefined, page: undefined })
          }}>
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {data.models.length > 0 && <>
          <label>Evaluation model
            <select value={data.model} onChange={(event) => setFilters({ ...filters, model: event.currentTarget.value || undefined, page: undefined })}>
              {data.models.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Reasoning
            <select value={data.reasoning} onChange={(event) => setFilters({ ...filters, reasoning: event.currentTarget.value || undefined, page: undefined })}>
              {data.reasons.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Scenario
            <select value={data.scenario} onChange={(event) => setFilters({ ...filters, scenario: event.currentTarget.value || undefined, page: undefined })}>
              <option value="">All scenarios</option>
              {data.scenarios.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          {data.suites.length > 1 && <label>Suite revision
            <select value={data.suite} onChange={(event) => setFilters({ ...filters, suite: event.currentTarget.value || undefined, page: undefined })}>
              {data.suites.map((item) => <option key={item} value={item}>
                {item === UNKNOWN_SUITE ? 'Unrecorded' : item.slice(0, 12)}
              </option>)}
            </select>
          </label>}
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
            <thead><tr><th scope="col">Commit date</th><th scope="col">Commit</th><th scope="col">Source</th>
              <th scope="col">Result</th><th scope="col">Samples</th></tr></thead>
            <tbody>{data.rows.map((run) => <tr key={run.id}>
              <th scope="row" title={`Evaluated ${INSIGHTS_DATE.format(run.recordedAt)}`}>
                {INSIGHTS_DATE.format(run.committedAt ?? run.recordedAt)}{run.committedAt === undefined && <small>Run date</small>}
              </th>
              <td><code title={run.sha}>{run.sha.slice(0, 12)}</code></td>
              <td>{run.source === 'release' && run.version ? `Leon ${run.version}` : SOURCE_LABELS[run.source ?? 'local']}
                {run.runUrl && <small><a href={run.runUrl} target="_blank" rel="noreferrer">CI run {run.runId}</a></small>}
              </td>
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
