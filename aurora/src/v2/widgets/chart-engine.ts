import { color, init, use } from 'echarts/core'
import { DatasetComponent, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, AriaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { ChartInstance } from './chart'
import { MAXIMUM_GENERATED_HEIGHT } from '../contracts/generated'

use([DatasetComponent,
  GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, VisualMapComponent, AriaComponent, CanvasRenderer])

const CHART_LIMITS = { surface: 8, insights: 10 } as const
type ChartScope = keyof typeof CHART_LIMITS

const instances = new Map<EChartsType, { observer: ResizeObserver, option: Record<string, unknown>, scope: ChartScope }>()
const PALETTE_TOKENS = ['--color-accent', '--color-accent-pink', '--color-purple', '--color-success', '--color-yellow']
const MAXIMUM_CHART_WIDTH = 2_048

function chartSize(element: HTMLElement): { width: number, height: number } {
  return { width: Math.min(MAXIMUM_CHART_WIDTH, Math.max(1, element.clientWidth)),
    height: Math.min(MAXIMUM_GENERATED_HEIGHT, Math.max(1, element.clientHeight)) }
}

function themedAxes(value: unknown, text: string, border: string, fontSize: number): unknown {
  if (Array.isArray(value)) {
    return value.map((axis) => themedAxes(axis, text, border, fontSize))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const axis = value as Record<string, unknown>
  const axisLine = axis['axisLine'] as Record<string, unknown> | undefined
  const splitLine = axis['splitLine'] as Record<string, unknown> | undefined

  return { ...axis,
    axisLabel: { ...(axis['axisLabel'] as object), color: text, fontSize },
    axisLine: { ...axisLine, lineStyle: { ...(axisLine?.['lineStyle'] as object), color: border } },
    splitLine: { ...splitLine, lineStyle: { ...(splitLine?.['lineStyle'] as object), color: border } },
    nameTextStyle: { ...(axis['nameTextStyle'] as object), color: text, fontSize }
  }
}

function themed(option: Record<string, unknown>, scope: ChartScope): Record<string, unknown> {
  const styles = getComputedStyle(document.documentElement)
  const text = styles.getPropertyValue('--color-text-secondary').trim()
  const border = styles.getPropertyValue('--color-border-secondary').trim()
  const fontSize = Number.parseFloat(styles.getPropertyValue('--font-size-sm'))
  const radius = Number.parseFloat(styles.getPropertyValue('--border-radius-sm'))
  const legend = option['legend']
  const palette = PALETTE_TOKENS.map((name) => styles.getPropertyValue(name).trim())
  const legendStyle = (value: object): object => ({ ...value, textStyle: { color: text, fontSize } })
  const styleSeries = (value: unknown, index = 0): unknown => {
    if (!value || typeof value !== 'object') {
      return value
    }
    const series = value as Record<string, unknown>
    const area = series['areaStyle'] as { color?: unknown } | undefined
    const seriesColor = palette[index % palette.length]

    // Shared defaults also apply to bespoke charts without overriding authored
    // data, deliberate series styles or the chart's numerical scale.
    return {
      ...(series['type'] === 'bar' ? { barMaxWidth: 40 } : {}),
      ...(series['type'] === 'line' ? { symbolSize: 6, showSymbol: false } : {}),
      ...series,
      ...(scope === 'insights' && area && !area.color && seriesColor ? {
        areaStyle: { ...area, color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: color.modifyAlpha(seriesColor, 0.27) },
            { offset: 1, color: color.modifyAlpha(seriesColor, 0) }
          ]
        } }
      } : {}),
      // Transparent chart surfaces cannot provide a matching automatic text halo.
      label: { textBorderColor: 'transparent', ...(series['label'] as object) },
      ...(series['type'] === 'bar'
        ? { itemStyle: { borderRadius: radius, ...(series['itemStyle'] as object) } }
        : {})
    }
  }

  return { ...option, color: palette,
    backgroundColor: 'transparent', darkMode: styles.colorScheme === 'dark', animation: false,
    textStyle: { fontFamily: styles.getPropertyValue('--font-family').trim(), color: text, fontSize },
    tooltip: { trigger: 'item', ...(option['tooltip'] as object), renderMode: 'richText',
      backgroundColor: styles.getPropertyValue('--color-surface-elevated').trim(),
      borderColor: border, textStyle: { color: text, fontSize } },
    ...(option['series'] ? {
      series: Array.isArray(option['series']) ? option['series'].map(styleSeries) : styleSeries(option['series'])
    } : {}),
    ...(legend ? { legend: Array.isArray(legend) ? legend.map(legendStyle) : legendStyle(legend as object) } : {}),
    ...(option['xAxis'] ? { xAxis: themedAxes(option['xAxis'], text, border, fontSize) } : {}),
    ...(option['yAxis'] ? { yAxis: themedAxes(option['yAxis'], text, border, fontSize) } : {}),
    aria: { enabled: true }
  }
}

function refreshChart(chart: EChartsType, option: Record<string, unknown>, scope: ChartScope): void {
  // Theme changes must preserve the owner's legend and zoom choices.
  const current = chart.getOption()
  chart.setOption(themed({ ...option,
    ...(current['legend'] ? { legend: current['legend'] } : {}),
    ...(current['dataZoom'] ? { dataZoom: current['dataZoom'] } : {})
  }, scope))
}

/**
 * Owns bounded chart instances for either a native answer or an isolated surface.
 * Callers load this engine on demand and dispose each instance when it leaves.
 */
export const chartEngine = {
  async create(element: HTMLElement, option: Record<string, unknown>, scope: ChartScope = 'surface'): Promise<ChartInstance> {
    // Series stay outside the initial engine graph, rather than shipping one
    // indivisible chart bundle for every generated interface.
    await import('./chart-series')
    const previous = [...instances].find(([chart]) => chart.getDom() === element)
    if (previous) {
      previous[1].observer.disconnect()
      instances.delete(previous[0])
      previous[0].dispose()
    }
    if ([...instances.values()].filter((instance) => instance.scope === scope).length >= CHART_LIMITS[scope]) {
      throw new Error('Use fewer charts in one interface.')
    }
    const chart = init(element, undefined, { ...chartSize(element), devicePixelRatio: Math.min(devicePixelRatio, 2) })
    const resize = (): void => chart.resize(chartSize(element))
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const record = { observer, option, scope }
    instances.set(chart, record)
    try {
      chart.setOption(themed(option, scope))
    } catch (error) {
      observer.disconnect()
      instances.delete(chart)
      chart.dispose()
      throw error
    }

    return {
      setOption(next): void {
        record.option = next
        chart.setOption(themed(next, scope), true)
      },
      resize,
      refresh: (): void => refreshChart(chart, record.option, scope),
      on: (event, handler): void => { chart.on(event, handler) },
      dispose: (): void => {
        observer.disconnect()
        instances.delete(chart)
        chart.dispose()
      }
    }
  },
  refresh(): void {
    for (const [chart, record] of instances) {
      refreshChart(chart, record.option, record.scope)
    }
  },
  /**
   * Redraws chart pixels for export without resizing the live interface or
   * changing the owner's legend, zoom and data selections.
   */
  snapshots(root: HTMLElement): ReadonlyMap<HTMLCanvasElement, string> {
    const images = new Map<HTMLCanvasElement, string>()
    for (const chart of instances.keys()) {
      if (!root.contains(chart.getDom())) {
        continue
      }
      const canvas = chart.getDom().querySelector('canvas')
      if (canvas) {
        const pixelRatio = Math.min(2, MAXIMUM_CHART_WIDTH / chart.getWidth(), MAXIMUM_GENERATED_HEIGHT / chart.getHeight())
        images.set(canvas, chart.getDataURL({ type: 'png', pixelRatio, excludeComponents: ['tooltip'] }))
      }
    }

    return images
  },
  dispose(): void {
    for (const [chart, record] of instances) {
      record.observer.disconnect()
      chart.dispose()
    }
    instances.clear()
  }
}
