import { useState } from 'react'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import type {
  InsightsInterval, UsageTurnView, InsightsUsage
} from '../../../../../server/src/core/insights/insights-contract'

import { INSIGHTS_DATE, InsightsChart, metricRatio, metricSeconds, formatMetric } from './insights-charts'
import { insightsBucketLabels } from './insights-overview'

const CONTEXT_LABELS = {
  transcript: 'Transcript', system: 'System instructions', tools: 'Tool definitions',
  images: 'Images', compaction: 'Compaction summaries'
} as const

function turnModel(turn: UsageTurnView): string {
  return [turn.provider, turn.model].filter(Boolean).join(' / ') || 'Unknown model'
}

function turnLabel(turn: UsageTurnView, context = false): string {
  const target = context ? turn.context?.contextTarget : undefined
  const model = target ? `${target.provider} / ${target.model}` : turnModel(turn)
  return `${INSIGHTS_DATE.format(turn.startedAt)} · ${model}${turn.version ? ` · Leon ${turn.version}` : ''}`
}

function turnTokens(turn: UsageTurnView | undefined): number | null {
  return turn && turn.modelCalls > 0 && turn.meteredCalls === turn.modelCalls
    ? turn.inputTokens + turn.outputTokens : null
}

function TurnTable({ turns }: { turns: UsageTurnView[] }) {
  return <div className="insights-table-scroll">
    <table aria-label="Compared turns">
      <thead><tr>
        <th scope="col">Turn</th><th scope="col">Tokens</th><th scope="col">Cache</th>
        <th scope="col">Duration</th><th scope="col">Calls</th><th scope="col">Context</th>
      </tr></thead>
      <tbody>{turns.map((turn, index) => <tr key={`${turn.startedAt}-${index}`}>
        <th scope="row">{turnLabel(turn)}<small>{turn.outcome}</small></th>
        <td>{formatMetric(turn.tokenReportedCalls > 0 ? turn.inputTokens + turn.outputTokens : null)}
          {turn.tokenReportedCalls > 0 && turn.meteredCalls < turn.modelCalls && <small>Partial</small>}</td>
        <td>{formatMetric(turn.cacheReportedCalls > 0 ? turn.cachedInputTokens : null)}</td>
        <td>{formatMetric(metricSeconds(turn.durationMs), ' s')}</td>
        <td>{turn.modelCalls} model<small>{turn.toolCalls} tool</small></td>
        <td>{formatMetric(turn.context?.contextUsagePercent, '%')}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

/**
 * Shows measured window occupancy and the estimated prompt mix of a selected turn.
 */
export function InsightsContextWindow({ usage, interval, changePage }: {
  usage: InsightsUsage
  interval: InsightsInterval
  changePage: (page: number) => void
}) {
  const [selection, setSelection] = useState(0)
  const available = usage.recentTurns.filter((turn) => turn.context)
  const selected = available[selection] ?? available[0]
  const context = selected?.context
  const occupancy = context?.contextUsagePercent ?? null
  const parts = context?.contextTokenBreakdown
  const entries = parts ? Object.entries(parts) as [keyof typeof CONTEXT_LABELS, number][] : []
  const estimatedTokens = entries.reduce((sum, [, tokens]) => sum + tokens, 0)
  const shares = entries.map(([part, tokens]) => ({
    part, tokens, prompt: metricRatio(tokens * 100, estimatedTokens)
  }))

  return <div className="insights-panel">
    <p className="insights-note">
      Context is everything. Keep track of how much room each turn has to work with.
    </p>
    <InsightsChart title="Measured context occupancy over time" unit="%" labels={insightsBucketLabels(usage, interval)}
      description={`${formatMetric(usage.current.contextCount)} turns with a provider-reported input count and a known context limit.`}
      details={insightsBucketLabels(usage, interval).map((label, index) =>
        `${label} · ${formatMetric(usage.series[index]?.contextCount)} measured turns`
      )}
      series={[
        { label: 'Median', values: usage.series.map((row) => row.medianContextPercent ?? null) },
        { label: 'p95', values: usage.series.map((row) => row.p95ContextPercent ?? null) },
        { label: 'Previous median', values: usage.series.map((row) => row.previous?.medianContextPercent ?? null), previous: true }
      ]} />
    {selected && context ? <>
      {usage.contextPages > 1 && <div className="insights-actions" aria-label="Context turn pages">
        <Button size="sm" disabled={usage.contextPage === 0} onClick={() => changePage(usage.contextPage - 1)}>Newer turns</Button>
        <span>Page {usage.contextPage + 1} of {usage.contextPages}</span>
        <Button size="sm" disabled={usage.contextPage + 1 >= usage.contextPages}
          onClick={() => changePage(usage.contextPage + 1)}>Older turns</Button>
      </div>}
      <label>Turn
        <select value={available[selection] ? selection : 0} onChange={(event) => setSelection(Number(event.currentTarget.value))}>
          {available.map((turn, index) => <option key={`${turn.startedAt}-${index}`} value={index}>{turnLabel(turn, true)}</option>)}
        </select>
      </label>
      <div className="insights-chart-grid">
        <InsightsChart title="Context window used and available" kind="bar" stacked percent unit="%" labels={['Selected turn']}
          description={`${context.contextUsageEstimated ? 'Estimated input' : 'Reported input'} ${formatMetric(context.contextUsedTokens)} tokens · context limit ${formatMetric(context.contextWindowTokens)} tokens.`}
          series={[
            { label: 'Used', values: [occupancy === null ? null : Math.min(occupancy, 100)] },
            { label: 'Available', values: [occupancy === null ? null : Math.max(0, 100 - occupancy)] }
          ]} />
        {shares.length > 0 && <InsightsChart title="Prepared prompt composition" kind="bar" stacked percent
          unit="%" labels={['Selected turn']} description="Estimated share of the prepared input."
          series={shares.map(({ part, prompt }) => ({ label: CONTEXT_LABELS[part], values: [prompt] }))} />}
      </div>
      {shares.length > 0 ? <div className="insights-table-scroll">
        <table aria-label="Context component breakdown">
          <thead><tr><th scope="col">Context component</th><th scope="col">Estimated tokens</th>
            <th scope="col">Share of prompt</th><th scope="col">Share of window</th></tr></thead>
          <tbody>{shares.map(({ part, tokens, prompt }) => <tr key={part}>
            <th scope="row">{CONTEXT_LABELS[part]}</th><td>{formatMetric(tokens)}</td>
            <td>{formatMetric(prompt, '%')}</td>
            <td>{formatMetric(prompt === null || occupancy === null ? null : prompt * occupancy / 100, '%')}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="insights-note">This saved turn has an input count but no per-component breakdown.</p>}
    </> : <p>No saved context snapshots in this period.</p>}
  </div>
}

type RepeatedGroup = InsightsUsage['repeatedQueries'][number]

function RepeatedComparison({ group }: { group: RepeatedGroup }) {
  const [baselineIndex, setBaselineIndex] = useState(0)
  const turns = [...group.turns].reverse()
  const baseline = turns[baselineIndex]
  const latest = turns.at(-1)
  const baselineTokens = turnTokens(baseline)
  const latestTokens = turnTokens(latest)
  const delta = baselineTokens !== null && latestTokens !== null
    ? metricRatio((latestTokens - baselineTokens) * 100, baselineTokens) : null
  const dates = turns.map((turn) => INSIGHTS_DATE.format(turn.startedAt))
  const details = turns.map((turn) => turnLabel(turn))

  return <div className="insights-panel">
    <label>Baseline occurrence
      <select value={baselineIndex} onChange={(event) => setBaselineIndex(Number(event.currentTarget.value))}>
        {turns.map((turn, index) => <option key={`${turn.startedAt}-${index}`} value={index}>{turnLabel(turn)}</option>)}
      </select>
    </label>
    <p className="insights-note">
      {group.occurrences} matching first turns in the scanned history.
      {delta !== null && ` Latest measured occurrence ${formatMetric(latestTokens)} tokens · baseline ${formatMetric(baselineTokens)} tokens · ${delta > 0 ? '+' : ''}${formatMetric(delta, '%')}.`}
    </p>
    <div className="insights-chart-grid">
      <InsightsChart title="Tokens for the same query" labels={dates} details={details} series={[
        { label: 'Measured input + output', values: turns.map(turnTokens) },
        { label: 'Selected baseline', values: turns.map(() => baselineTokens), previous: true },
        { label: 'Reported cached input', values: turns.map((turn) => turn.cacheReportedCalls ? turn.cachedInputTokens : null) }
      ]} />
      <InsightsChart title="Latency for the same query" labels={dates} details={details} unit=" s" series={[
        { label: 'Turn duration', values: turns.map((turn) => metricSeconds(turn.durationMs)) },
        { label: 'Selected baseline', values: turns.map(() => metricSeconds(baseline?.durationMs)), previous: true },
        { label: 'First model output', values: turns.map((turn) => metricSeconds(turn.firstOutputMs)) }
      ]} />
      <InsightsChart title="Model and tool calls for the same query" labels={dates} details={details} series={[
        { label: 'Models', values: turns.map((turn) => turn.modelCalls) },
        { label: 'Tools', values: turns.map((turn) => turn.toolCalls) }
      ]} />
      <InsightsChart title="Context occupancy for the same query" labels={dates} details={details} unit="%" series={[
        { label: 'Window used', values: turns.map((turn) => turn.context?.contextUsagePercent ?? null) },
        { label: 'Selected baseline', values: turns.map(() => baseline?.context?.contextUsagePercent ?? null), previous: true }
      ]} />
      <InsightsChart title="Output rate for the same query" labels={dates} details={details} unit=" tok/s"
        description="Reported output tokens divided by recorded model time, including provider wait."
        series={[{ label: 'Output rate', values: turns.map((turn) =>
          turnTokens(turn) === null ? null : metricRatio(turn.outputTokens * 1_000, turn.modelDurationMs)
        ) }]} />
    </div>
    <TurnTable turns={turns} />
  </div>
}

/**
 * Compares saved first turns with matching wording in this profile.
 */
export function InsightsRepeatedFirstTurns({ usage }: { usage: InsightsUsage }) {
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState(0)
  const groups = usage.repeatedQueries.filter((group) => group.message.toLowerCase().includes(search.trim().toLowerCase()))
  const selected = groups[selection] ?? groups[0]

  return <div className="insights-panel">
    <p className="insights-note">
      I only compare the first message you send in each session. Queries match after trimming surrounding whitespace and ignoring case.
    </p>
    <label>Find a first-turn query
      <Input ariaLabel="Find a first-turn query" value={search} onChange={(event) => {
        setSearch(event.currentTarget.value)
        setSelection(0)
      }} />
    </label>
    {selected ? <>
      <label>Repeated wording
        <select value={groups[selection] ? selection : 0} onChange={(event) => setSelection(Number(event.currentTarget.value))}>
          {groups.map((group, index) => <option key={index} value={index}>{group.message} · {group.occurrences}</option>)}
        </select>
      </label>
      <RepeatedComparison key={`${selection}-${selected.turns.at(-1)?.startedAt}-${selected.turns.length}`} group={selected} />
    </> : <p>No repeated first-turn queries found for this period.</p>}
  </div>
}
