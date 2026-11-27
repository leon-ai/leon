import { useState } from 'react'

import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { useInsightsPulse } from '@/data/insights'
import { formatToolDuration } from '@/utils/format-tool-duration'
import {
  PULSE_INSIGHTS_RETENTION_DAYS, PulseTickOutcome, type PulseTick, type PulseTickEvent, type PulseTickTrigger
} from '../../../../../server/src/core/insights/insights-contract'

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const NUMBER = new Intl.NumberFormat()
const OUTCOME_LABELS: Record<PulseTickOutcome, string> = {
  [PulseTickOutcome.Idle]: 'No lead',
  [PulseTickOutcome.Skipped]: 'Skipped',
  [PulseTickOutcome.Quiet]: 'Stayed quiet',
  [PulseTickOutcome.Duplicate]: 'Duplicate',
  [PulseTickOutcome.Saved]: 'Saved',
  [PulseTickOutcome.Shared]: 'Shared',
  [PulseTickOutcome.Failed]: 'Failed',
  [PulseTickOutcome.Unknown]: 'Outcome unavailable'
}
const TRIGGER_LABELS: Record<PulseTickTrigger, string> = {
  scheduled: 'Scheduled', follow_up: 'Follow-up', manual: 'Manual'
}
const PHASE_LABELS: Record<PulseTickEvent['phase'], string> = {
  tick: 'Pulse', agenda: 'Follow-up', evidence: 'Context', planning: 'Planning',
  research: 'Research', review: 'Review', storage: 'Storage', delivery: 'Delivery'
}

function PulseDate({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{DATE_TIME.format(at)}</time>
}

function PulseTickRow({ tick }: { tick: PulseTick }) {
  return <details className="insights-pulse-tick">
    <summary>
      <strong>{OUTCOME_LABELS[tick.outcome]}</strong>{tick.matter && <> · {tick.matter}</>}
      <small>
        <PulseDate at={tick.startedAt} />
        {tick.recovered && ' · Earlier record'}
        {tick.trigger && <> · {TRIGGER_LABELS[tick.trigger]}</>}
        {tick.durationMs !== null && <> · {formatToolDuration(tick.durationMs)}</>}
      </small>
    </summary>
    {tick.recovered && <p className="insights-note">This entry shows the details I saved at the time.</p>}
    <ol className="insights-pulse-events">
      {tick.events.map((event, index) => <li key={`${event.code}-${index}`}>
        <small>{PHASE_LABELS[event.phase]}</small>
        <p>{event.detail}</p>
        {event.tools && <>
          {(event.toolCalls ?? 0) > event.tools.length &&
            <small>Showing {event.tools.length} of {event.toolCalls} tool calls</small>}
          <ul>
            {event.tools.map(({ name, status }, toolIndex) => <li key={`${name}-${toolIndex}`}>
              <code>{name}</code> · {status}
            </li>)}
          </ul>
        </>}
      </li>)}
    </ol>
    <details>
      <summary>Raw events</summary>
      <pre className="insights-pulse-raw">{JSON.stringify(tick.events, null, 2)}</pre>
    </details>
  </details>
}

/**
 * Shows what Pulse did with its opportunities and why each completed tick ended.
 */
export function InsightsPulse() {
  const [page, setPage] = useState(0)
  const { data, isFetching, isPending, isError, refetch } = useInsightsPulse(page)
  const outcomes = data?.outcomes ?? {}
  const saved = outcomes[PulseTickOutcome.Saved] ?? 0
  const shared = outcomes[PulseTickOutcome.Shared] ?? 0
  const otherOutcomes = Object.entries(OUTCOME_LABELS).filter(([outcome]) =>
    outcome !== PulseTickOutcome.Saved && outcome !== PulseTickOutcome.Shared
  )

  return <div className="insights-panel" aria-busy={isFetching}>
    {isPending && <Loader size="md" label="Loading Pulse activity…" />}
    {isError && <div className="insights-actions">
      <p className="insights-note" role="status">I couldn’t load my Pulse activity.</p>
      <Button size="sm" onClick={() => void refetch()}>Retry</Button>
    </div>}
    {data && <>
      <p className="insights-note">
        My recorded Pulse activity over the last {PULSE_INSIGHTS_RETENTION_DAYS} days. {data.enabled ? '' : 'Pulse is off.'}
      </p>
      <dl className="insights-values">
        <div className="insights-value">
          <dt>Pulses</dt><dd>{NUMBER.format(data.total)}</dd>
        </div>
        <div className="insights-value">
          <dt>Investigations</dt><dd>{NUMBER.format(data.investigated)}</dd>
        </div>
        <div className="insights-value">
          <dt>Useful results</dt><dd>{NUMBER.format(saved + shared)}</dd>
          <dd className="insights-previous">{NUMBER.format(saved)} saved · {NUMBER.format(shared)} shared</dd>
        </div>
      </dl>
      {data.total > 0 && <dl className="insights-pulse-breakdown">
        {otherOutcomes.filter(([outcome]) =>
          outcome !== PulseTickOutcome.Unknown || outcomes[PulseTickOutcome.Unknown]
        ).map(([outcome, label]) => <div key={outcome}>
          <dt>{label}</dt><dd>{NUMBER.format(outcomes[outcome as PulseTickOutcome] ?? 0)}</dd>
        </div>)}
      </dl>}
      {data.nextFollowUp && <section className="insights-trend">
        <h3>Next follow-up</h3>
        <p><strong>{data.nextFollowUp.matter}</strong> · <PulseDate at={data.nextFollowUp.checkAt} /></p>
        <p>{data.nextFollowUp.question}</p>
        <small>Expires <PulseDate at={data.nextFollowUp.expiresAt} /></small>
      </section>}
      {data.total === 0 ? <p className="insights-empty">I don’t have any Pulse activity recorded for this period.</p> : <section>
        <h3>Pulse history</h3>
        {data.ticks.map((tick) => <PulseTickRow key={tick.id} tick={tick} />)}
      </section>}
      {data.pages > 1 && <div className="insights-actions">
        <Button size="sm" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>Newer</Button>
        <small>Page {data.page + 1} of {data.pages}</small>
        <Button size="sm" disabled={data.page + 1 >= data.pages} onClick={() => setPage(data.page + 1)}>Older</Button>
      </div>}
    </>}
  </div>
}
