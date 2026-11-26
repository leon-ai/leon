import { lazy, Suspense, useState } from 'react'

import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { useInsightsUsage } from '@/data/insights'
import { type InsightsTab } from '@/layout/app-layout/dialog-navigation'
import { Tabs } from '../../../../../aurora/src/v2/components/tabs'
import { INSIGHTS_RANGES, type InsightsInterval } from '../../../../../server/src/core/insights/insights-contract'

import { InsightsOverview } from './insights-overview'
import { InsightsContextWindow, InsightsRepeatedFirstTurns } from './insights-turns'

import './insights-page.sass'

const InsightsEvaluations = lazy(() => import('./insights-evaluations'))

const INTERVAL_LABELS = {
  day: 'Daily', week: 'Weekly', month: 'Monthly'
} as const

/**
 * Keeps the owner’s usage, context, repeated first turns and controlled evals in dedicated views.
 */
export function Insights({ tab, selectTab }: { tab: InsightsTab, selectTab: (tab: InsightsTab) => void }) {
  const [days, setDays] = useState(30)
  const [interval, setInterval] = useState<InsightsInterval>('day')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [contextPage, setContextPage] = useState(0)
  const query = useInsightsUsage({
    days, provider, model, repeated: tab === 'repeated-queries', interval,
    contextPage: tab === 'context-window' ? contextPage : undefined, enabled: tab !== 'evaluations'
  })
  const usage = query.data
  const models = (tab === 'context-window' ? usage?.contextModels : usage?.models) ?? []
  const providerNames = [...new Set(models.map((row) => row.provider))]
  const modelNames = [...new Set(models.filter((row) => !provider || provider === row.provider).map((row) => row.model))]

  return <div className="insights-usage">
    {tab !== 'evaluations' && <>
      <div className="insights-filters">
        <label>Period
          <select value={days} onChange={(event) => {
            setDays(Number(event.currentTarget.value))
            setContextPage(0)
          }}>
            {INSIGHTS_RANGES.map((range) => <option key={range} value={range}>{range === 365 ? 'Last year' : `Last ${range} days`}</option>)}
          </select>
        </label>
        <label>Chart interval
          <select value={interval} onChange={(event) => setInterval(event.currentTarget.value as InsightsInterval)}>
            {Object.entries(INTERVAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Provider
          <select value={provider} onChange={(event) => {
            setProvider(event.currentTarget.value)
            setModel('')
            setContextPage(0)
          }}>
            <option value="">All providers</option>
            {providerNames.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label>Model
          <select value={model} onChange={(event) => {
            setModel(event.currentTarget.value)
            setContextPage(0)
          }}>
            <option value="">All models</option>
            {modelNames.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>
      {tab !== 'repeated-queries' && <p className="insights-note">
        UTC periods. Previous values cover an equal length of time. {tab === 'context-window'
          ? 'Provider and model filters use the model associated with the context snapshot.'
          : 'Provider and model filters use the most-called model on a turn.'}
      </p>}
      {query.isPending && <Loader size="md" label="Reading activity…" />}
      {query.isPlaceholderData && <p role="status" className="insights-note">Updating activity…</p>}
      {query.isError && <Button size="sm" onClick={() => void query.refetch()}>Retry loading activity</Button>}
      {Boolean(usage?.unreadableRecords) && <p role="status" className="insights-note">
        Some saved activity could not be read. These totals use the remaining records.
      </p>}
    </>}
    <Tabs label="Insights" value={tab} onValueChange={(value) => selectTab(value as InsightsTab)} items={[
      {
        value: 'overview', label: 'Overview',
        content: usage && <InsightsOverview usage={usage} interval={interval} provider={provider} model={model} />
      },
      {
        value: 'context-window', label: 'Context window',
        content: usage && <InsightsContextWindow key={`${usage.contextPage}-${provider}-${model}`}
          usage={usage} interval={interval} changePage={setContextPage} />
      },
      {
        value: 'repeated-queries', label: 'Repeated first turns',
        content: usage && !query.isPlaceholderData && <InsightsRepeatedFirstTurns usage={usage} />
      },
      {
        value: 'evaluations', label: 'Evaluations',
        content: <Suspense fallback={<Loader size="md" label="Opening evaluations…" />}><InsightsEvaluations /></Suspense>
      }
    ]} />
  </div>
}
