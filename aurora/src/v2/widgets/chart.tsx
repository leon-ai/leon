import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Surface } from '../components/surface'
import { Loader } from '../components/loader/loader'
import type { ChartData } from '../contracts/presentation'
import { DataTableWidget } from './data-table'

import './presentation.sass'

const AXIS_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: 'compact', maximumFractionDigits: 1
})
const VALUE_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 20
})

export interface ChartInstance {
  dispose: () => void
  resize: () => void
  refresh: () => void
  setOption: (option: Record<string, unknown>) => void
  on: (event: string, handler: (value: unknown) => void) => void
}

export type CreateChart = (element: HTMLElement, option: Record<string, unknown>) => Promise<ChartInstance>

export interface ChartWidgetProps extends ChartData {
  createChart: CreateChart
  onReady?: () => void
}

/**
 * Shares semantic chart construction and an accessible table while leaving
 * optional engine loading to the host or isolated runtime's existing bridge.
 */
export function ChartWidget({ title, description, kind, categories, series, unit, createChart, onReady }: ChartWidgetProps) {
  const element = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [dataOpen, setDataOpen] = useState(false)
  // Equal data can arrive in fresh replay/cache objects. Preserve chart state
  // instead of tearing down the canvas merely because array identities changed.
  const source = JSON.stringify({ kind, categories, series, unit })
  const option = useMemo(() => {
    const { kind, categories, series, unit } = JSON.parse(source) as ChartData
    const showLegend = kind === 'pie' || series.length > 1

    return {
      tooltip: {
        trigger: kind === 'pie' ? 'item' : 'axis',
        valueFormatter: (value: unknown) =>
          `${typeof value === 'number' ? VALUE_FORMATTER.format(value) : String(value)}${unit ? ` ${unit}` : ''}`
      },
      ...(showLegend ? { legend: { type: 'scroll', bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 } } : {}),
      ...(kind !== 'pie' ? {
        grid: { left: 8, right: 12, top: 36, bottom: showLegend ? 48 : 12, containLabel: true },
        xAxis: {
          type: 'category', data: categories,
          boundaryGap: kind === 'bar',
          axisTick: { show: false }, axisLine: { show: false },
          axisLabel: { hideOverlap: true, margin: 12 }
        },
        yAxis: {
          type: 'value', ...(unit ? { name: unit, nameGap: 18 } : {}),
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { margin: 12, formatter: (value: number) => AXIS_FORMATTER.format(value) },
          splitLine: { lineStyle: { type: 'dashed' } }
        }
      } : {}),
      series: series.map((item) => ({
        name: item.label, type: kind,
        ...(kind === 'pie' ? {
          radius: ['45%', '70%'], center: ['50%', '45%'],
          label: { show: false }, emphasis: { label: { show: true } },
          data: item.values.map((value, index) => ({ name: categories[index], value }))
        } : { data: item.values })
      }))
    }
  }, [source])
  const columns = useMemo(() => [
    { key: 'category', label: 'Category' },
    ...series.map((item, index) => ({ key: `series-${index}`, label: `${item.label}${unit ? ` (${unit})` : ''}` }))
  ], [series, unit])
  const rows = useMemo(() => categories.map((category, index) => ({
    id: String(index), values: Object.fromEntries([
      ['category', category], ...series.map((item, seriesIndex) => [`series-${seriesIndex}`, item.values[index]!])
    ])
  })), [categories, series])

  useLayoutEffect(() => {
    const container = element.current
    if (!container) {
      return undefined
    }

    let active = true
    let instance: ChartInstance | undefined
    let theme: MutationObserver | undefined
    setStatus('loading')
    void createChart(container, option).then((chart) => {
      if (!active) {
        chart.dispose()
        return
      }

      instance = chart
      setStatus('ready')
      theme = new MutationObserver(() => chart.refresh())
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    }).catch(() => {
      if (active) {
        setStatus('failed')
      }
    })

    return () => {
      active = false
      theme?.disconnect()
      instance?.dispose()
    }
  }, [createChart, option])

  useLayoutEffect(() => {
    if (status !== 'loading') {
      onReady?.()
    }
  }, [status, onReady])

  return <Surface title={title} {...(description === undefined ? {} : { description })}>
    <div className="aurora-chart-frame">
      {status === 'loading' && <span className="aurora-chart-loading"><Loader size="sm" label="Drawing the chart…" /></span>}
      <div className="aurora-chart" ref={element} role="img" aria-label={`${title}. Data is available below.`} />
    </div>
    {status === 'failed' && <p role="status" className="aurora-feedback">I couldn’t draw the chart. The data is available below.</p>}
    <details className="aurora-chart-data" open={dataOpen || status === 'failed'} data-image-export-ignore
      onToggle={(event) => setDataOpen(event.currentTarget.open)}>
      <summary>View data</summary>
      {(dataOpen || status === 'failed') && <DataTableWidget title={`${title} data`} columns={columns} rows={rows} searchable={false} />}
    </details>
  </Surface>
}
