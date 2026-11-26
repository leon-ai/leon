import { DurationFormat, formatToolDuration } from '@/utils/format-tool-duration'

import type {
  InsightsInterval, UsageSummary, InsightsUsage
} from '../../../../../server/src/core/insights/insights-contract'

import {
  INSIGHTS_DATE, InsightsChart, metricRatio, metricSeconds, formatMetric, type InsightsSeries
} from './insights-charts'

const UTC_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const UTC_MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * Labels aligned comparison points with the matching current UTC bucket.
 */
export function insightsBucketLabels(usage: InsightsUsage, interval: InsightsInterval): string[] {
  const formatter = interval === 'month' ? UTC_MONTH : UTC_DAY
  return usage.series.map(({ day }) => formatter.format(day))
}

function PeriodValue({ label, current, previous, unit }: {
  label: string
  current: number | null
  previous: number | null
  unit?: string
}) {
  return <div className="insights-value">
    <dt>{label}</dt>
    <dd>{formatMetric(current, unit)}</dd>
    {previous !== null && <dd className="insights-previous">Previous {formatMetric(previous, unit)}</dd>}
  </div>
}

function reportedTokens(summary: UsageSummary): number | null {
  return summary.tokenReportedCalls > 0 ? summary.inputTokens + summary.outputTokens : null
}

function meanTokens(summary: UsageSummary): number | null {
  return metricRatio(summary.fullyMeasuredTokens, summary.fullyMeasuredTurns)
}

function cacheShare(summary: UsageSummary): number | null {
  return metricRatio(summary.cacheComparableCachedTokens * 100, summary.cacheComparableInputTokens)
}

/**
 * Puts activity, token distributions and latency trends side by side.
 */
export function InsightsOverview({ usage, interval, provider, model }: {
  usage: InsightsUsage
  interval: InsightsInterval
  provider: string
  model: string
}) {
  const { current, previous } = usage
  const labels = insightsBucketLabels(usage, interval)
  const providerCounts = new Map<string, number>()
  for (const row of usage.models) {
    providerCounts.set(row.provider, (providerCounts.get(row.provider) ?? 0) + row.modelCalls)
  }
  const favoriteProvider = [...providerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const favoriteModel = usage.models[0]?.model
  const curve = (
    label: string, read: (summary: UsageSummary) => number | null, prior = false
  ): InsightsSeries => ({
    label, values: usage.series.map((bucket) => prior ? (bucket.previous ? read(bucket.previous) : null) : read(bucket)),
    ...(prior ? { previous: true } : {})
  })
  const modelRate = (summary: UsageSummary): number | null =>
    summary.tokenReportedCalls > 0 ? metricRatio(summary.outputTokens * 1_000, summary.modelDurationMs) : null
  const filteredModels = usage.models.filter((row) => (!provider || row.provider === provider) && (!model || row.model === model))
  const filteredProviders = new Map<string, number>()
  for (const row of filteredModels) {
    filteredProviders.set(row.provider, (filteredProviders.get(row.provider) ?? 0) + row.modelCalls)
  }
  const providerUsage = [...filteredProviders].sort((a, b) => b[1] - a[1])

  return <div className="insights-panel">
    {usage.firstOwnerMessageAt && <p className="insights-note">
      I first met you on {INSIGHTS_DATE.format(usage.firstOwnerMessageAt)} in the conversation history I still have.
    </p>}
    {current.turns === 0 && previous.turns === 0 && <p>No recorded agent turns in these periods.</p>}
    <dl className="insights-values">
      <PeriodValue label="Reported tokens" current={reportedTokens(current)} previous={reportedTokens(previous)} />
      <PeriodValue label="Agent turns" current={current.turns} previous={previous.turns} />
      <div className="insights-value">
        <dt>Time spent</dt>
        <dd>{current.durationMs ? formatToolDuration(current.durationMs, DurationFormat.Compact) : '0s'}</dd>
        <dd className="insights-previous">Previous {previous.durationMs ? formatToolDuration(previous.durationMs, DurationFormat.Compact) : '0s'}</dd>
      </div>
      <PeriodValue label="Model calls" current={current.modelCalls} previous={previous.modelCalls} />
      <PeriodValue label="Tool calls" current={current.toolCalls} previous={previous.toolCalls} />
      <PeriodValue label="Cached input tokens" current={current.cacheReportedCalls ? current.cachedInputTokens : null}
        previous={previous.cacheReportedCalls ? previous.cachedInputTokens : null} />
    </dl>
    {!provider && !model && favoriteProvider && favoriteModel && <p className="insights-note">
      Most-used provider <strong>{favoriteProvider}</strong> · Most-used model <strong>{favoriteModel}</strong>
    </p>}
    <div className="insights-chart-grid">
      <InsightsChart title="Tokens per turn" labels={labels} details={labels.map((label, index) =>
        `${label} · ${formatMetric(usage.series[index]?.fullyMeasuredTurns)} measured turns · previous ${formatMetric(usage.series[index]?.previous?.fullyMeasuredTurns)}`
      )}
        description={`Period mean ${formatMetric(meanTokens(current))} tokens · previous ${formatMetric(meanTokens(previous))}. Complete accounting for ${formatMetric(current.fullyMeasuredTurns)} of ${formatMetric(current.turns)} turns.`}
        series={[
          curve('Mean', meanTokens), curve('Median', (s) => s.medianTurnTokens), curve('p95', (s) => s.p95TurnTokens),
          curve('Previous mean', meanTokens, true)
        ]} />
      <InsightsChart title="Reported tokens" labels={labels}
        description="Cached input is included in the input total." series={[
        curve('Input', (s) => s.tokenReportedCalls ? s.inputTokens : null),
        curve('Output', (s) => s.tokenReportedCalls ? s.outputTokens : null),
        curve('Cached input', (s) => s.cacheReportedCalls ? s.cachedInputTokens : null)
      ]} />
      <InsightsChart title="Agent turn outcomes" labels={labels} kind="bar" stacked series={[
        curve('Answered', (s) => s.finishedTurns), curve('Clarification', (s) => s.clarificationTurns),
        curve('Blocked', (s) => s.blockedTurns ?? 0), curve('Failed', (s) => s.failedTurns),
        curve('Canceled', (s) => s.canceledTurns)
      ]} />
      <InsightsChart title="Answer latency" labels={labels} unit=" s" series={[
        curve('Median', (s) => metricSeconds(s.medianAnswerMs)), curve('p95', (s) => metricSeconds(s.p95AnswerMs)),
        curve('Previous median', (s) => metricSeconds(s.medianAnswerMs), true),
        curve('First model output · mean', (s) => metricSeconds(metricRatio(s.firstOutputMs, s.firstOutputCount)))
      ]} />
      <InsightsChart title="Calls per turn" labels={labels} series={[
        curve('Model calls', (s) => metricRatio(s.modelCalls, s.turns)),
        curve('Tool calls', (s) => metricRatio(s.toolCalls, s.turns)),
        curve('Previous model calls', (s) => metricRatio(s.modelCalls, s.turns), true),
        curve('Previous tool calls', (s) => metricRatio(s.toolCalls, s.turns), true)
      ]} />
      <InsightsChart title="Prompt cache share" labels={labels} unit="%" percent
        description={`Cached share of input on ${formatMetric(current.cacheComparableCalls)} calls that reported both counts.`}
        series={[curve('Cached input', cacheShare), curve('Previous cached input', cacheShare, true)]} />
      <InsightsChart title="Output tokens per model second" labels={labels} unit=" t/s"
        description="Reported output divided by summed model attempt time, including provider wait."
        series={[curve('Current', modelRate), curve('Previous', modelRate, true)]} />
      <InsightsChart title="Turn and execution time" labels={labels} unit=" s"
        description="Model and tool durations sum their individual attempts. Attempts can overlap."
        series={[
          curve('Turns', (s) => metricSeconds(s.durationMs)), curve('Model attempts', (s) => metricSeconds(s.modelDurationMs)),
          curve('Tool executions', (s) => metricSeconds(s.toolDurationMs))
        ]} />
      <InsightsChart title="Usage by provider" kind="pie" description="Share of recorded model calls by provider."
        labels={providerUsage.map(([name]) => name)}
        series={[{ label: 'Model calls', values: providerUsage.map(([, calls]) => calls) }]} />
      <InsightsChart title="Usage by model" kind="pie" description="Share of recorded calls by provider and model."
        labels={filteredModels.map((row) => `${row.provider} / ${row.model}`)}
        series={[{ label: 'Model calls', values: filteredModels.map((row) => row.modelCalls) }]} />
    </div>
    {filteredModels.length > 0 && <details>
      <summary>Model usage details</summary>
      <div className="insights-table-scroll">
        <table>
          <thead><tr><th scope="col">Model</th><th scope="col">Calls</th>
            <th scope="col">Failed</th><th scope="col">Reported tokens</th>
            <th scope="col">Cached input</th></tr></thead>
          <tbody>{filteredModels.map((row) => <tr key={JSON.stringify([row.provider, row.model])}>
            <th scope="row">{row.model}<small>{row.provider}</small></th>
            <td>{formatMetric(row.modelCalls)}</td><td>{formatMetric(row.failedModelCalls)}</td>
            <td>{formatMetric(row.tokenReportedCalls > 0 ? row.inputTokens + row.outputTokens : null)}</td>
            <td>{formatMetric(row.cacheReportedCalls > 0 ? row.cachedInputTokens : null)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>}
  </div>
}
