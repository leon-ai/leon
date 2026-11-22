import { useEffect, useMemo, useRef, useState } from 'react'

import type { ChartInstance } from '../../../../../aurora/src/v2/widgets/chart'

export const INSIGHTS_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const AXIS_NUMBER = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
export const INSIGHTS_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export interface InsightsSeries {
  label: string
  values: (number | null)[]
  previous?: boolean
}

interface InsightsChartProps {
  title: string
  description?: string
  labels: string[]
  details?: string[]
  series: InsightsSeries[]
  unit?: string
  kind?: 'line' | 'bar' | 'pie'
  stacked?: boolean
  percent?: boolean
}

export function metricRatio(total: number, samples: number): number | null {
  return samples > 0 ? total / samples : null
}

export function formatMetric(value: number | null | undefined, unit = ''): string {
  return value == null ? '—' : `${INSIGHTS_NUMBER.format(value)}${unit}`
}

export function metricSeconds(value: number | null | undefined): number | null {
  return value == null ? null : value / 1_000
}

/**
 * Uses Aurora’s chart engine and exposes the same data to keyboard and screen-reader users.
 */
export function InsightsChart({
  title, description, labels, details, series, unit = '', kind = 'line', stacked = false, percent = false
}: InsightsChartProps) {
  const root = useRef<HTMLDivElement>(null)
  const chart = useRef<ChartInstance>(null)
  const [dataOpen, setDataOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const hasValues = series.some(({ values }) => values.some((value) => value !== null))
  const pieValues = kind === 'pie' ? series[0]?.values : undefined
  const pieTotal = pieValues?.reduce<number>((total, value) => total + (value ?? 0), 0) ?? 0
  const option = useMemo(() => kind === 'pie' ? {
    tooltip: { trigger: 'item', formatter: '{b}\n{c} calls ({d}%)' },
    legend: { type: 'scroll', bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '68%'], center: ['50%', '45%'], label: { show: false },
      data: labels.map((name, index) => ({ name, value: pieValues?.[index] ?? 0 }))
    }]
  } : {
    tooltip: {
      trigger: 'axis', valueFormatter: (value: number | null) => formatMetric(value, unit),
      ...(details ? { formatter: (points: { dataIndex: number, seriesName: string, value: number | null }[]) =>
        [details[points[0]?.dataIndex ?? 0],
          ...points.map(({ seriesName, value }) => `${seriesName}  ${formatMetric(value, unit)}`)].join('\n') } : {})
    },
    legend: { type: 'scroll', bottom: 0 },
    grid: { left: 10, right: 18, top: 12, bottom: 36, containLabel: true },
    xAxis: { type: 'category', data: labels, boundaryGap: kind === 'bar', axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', min: 0, ...(percent ? { max: 100 } : {}),
      axisLabel: { formatter: (value: number) => `${AXIS_NUMBER.format(value)}${unit}` } },
    series: series.map((item) => ({
      name: item.label, data: item.values, type: kind,
      ...(stacked ? { stack: 'total' } : {}),
      ...(kind === 'line' ? { symbol: 'circle', symbolSize: 7, showSymbol: true, showAllSymbol: true } : {}),
      ...(kind === 'line' && !item.previous ? { areaStyle: {} } : {}),
      ...(item.previous ? { lineStyle: { type: 'dashed' }, itemStyle: { opacity: 0.65 } } : {})
    }))
  }, [details, kind, labels, percent, pieValues, series, stacked, unit])

  const optionRef = useRef(option)
  useEffect(() => {
    optionRef.current = option
    chart.current?.setOption(option)
  }, [option])

  useEffect(() => {
    const element = root.current
    if (!hasValues || !element) {
      return
    }

    let active = true
    let theme: MutationObserver | undefined
    void import('../../../../../aurora/src/v2/widgets/chart-engine')
      .then(({ chartEngine }) => active ? chartEngine.create(element, optionRef.current, 'insights') : undefined)
      .then((instance) => {
        if (!instance) {
          return
        }
        if (!active) {
          instance.dispose()
          return
        }

        chart.current = instance
        instance.setOption(optionRef.current)
        setFailed(false)
        theme = new MutationObserver(() => instance.refresh())
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
      })
      .catch(() => {
        if (active) {
          setFailed(true)
        }
      })

    return () => {
      active = false
      theme?.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [hasValues])

  return <figure className="insights-trend" aria-label={title}>
    <figcaption><h3>{title}</h3>{description && <p>{description}</p>}</figcaption>
    {hasValues
      ? <div ref={root} className="insights-chart-canvas" role="img" aria-label={title} />
      : <p className="insights-empty">No measurements in this period.</p>}
    {hasValues && <details open={failed || dataOpen} onToggle={(event) => setDataOpen(event.currentTarget.open)}>
      <summary>{failed ? 'Chart unavailable · view data' : 'View data'}</summary>
      {(dataOpen || failed) && <div className="insights-table-scroll">
        <table aria-label={`${title} data`}>
          <thead><tr><th scope="col">{kind === 'pie' ? 'Category' : 'Period or sample'}</th>
            {series.map(({ label }) => <th key={label} scope="col">{label}</th>)}
            {pieValues && <th scope="col">Share</th>}</tr></thead>
          <tbody>{labels.map((label, index) => <tr key={`${label}-${index}`}>
            <th scope="row">{details?.[index] ?? label}</th>{series.map((item) => <td key={item.label}>{formatMetric(item.values[index], unit)}</td>)}
            {pieValues && <td>{formatMetric(metricRatio((pieValues[index] ?? 0) * 100, pieTotal), '%')}</td>}
          </tr>)}</tbody>
        </table>
      </div>}
    </details>}
  </figure>
}
