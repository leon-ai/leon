import * as echarts from 'echarts'
import { createCanvas } from '@napi-rs/canvas'

const CHART_PALETTE = [
  '#2563eb',
  '#0891b2',
  '#8b5cf6',
  '#f59e0b',
  '#10b981',
  '#ec4899'
]
const LIGHT_BACKGROUND = '#ffffff'
const DARK_BACKGROUND = '#0f172a'

type EChartsCanvas = ReturnType<NonNullable<
  Parameters<typeof echarts.setPlatformAPI>[0]['createCanvas']
>>

/**
 * Formats supported by the local chart renderer.
 */
export enum ChartFormat {
  Svg = 'svg',
  Png = 'png'
}

/**
 * Readable chart appearances for exported artifacts.
 */
export enum ChartTheme {
  Light = 'light',
  Dark = 'dark'
}

/**
 * Native ECharts options and sizing for one exported chart.
 */
export interface ChartRenderOptions {
  option: Record<string, unknown>
  format: ChartFormat
  theme: ChartTheme
  width: number
  height: number
  pixelRatio: number
  fontFamily: string
}

/**
 * Renders data charts without a browser, network fetches or evaluated model code.
 */
export async function renderChart(options: ChartRenderOptions): Promise<Buffer> {
  // Supply native text measurement to both renderers so exported labels have
  // the same metrics, rather than relying on SVG's approximate measurements.
  echarts.setPlatformAPI({
    createCanvas: () => createCanvas(1, 1) as unknown as EChartsCanvas,
    loadImage: () => {
      throw new Error(
        'Chart options must use data and built-in symbols, not image resources.'
      )
    }
  })

  const dark = options.theme === ChartTheme.Dark
  const textColor = dark ? '#e2e8f0' : '#0f172a'
  const mutedColor = dark ? '#94a3b8' : '#64748b'
  const lineColor = dark ? '#334155' : '#e2e8f0'
  const theme = {
    color: CHART_PALETTE,
    backgroundColor: dark ? DARK_BACKGROUND : LIGHT_BACKGROUND,
    textStyle: { fontFamily: options.fontFamily, color: textColor },
    title: {
      left: 24,
      top: 16,
      textStyle: { color: textColor, fontSize: 22, fontWeight: 600 },
      subtextStyle: { color: mutedColor, fontSize: 13 }
    },
    legend: { top: 54, textStyle: { color: mutedColor } },
    grid: { top: 96, right: 36, bottom: 36, left: 36, containLabel: true },
    categoryAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: mutedColor },
      splitLine: { show: false }
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: mutedColor },
      splitLine: { lineStyle: { color: lineColor } }
    }
  }
  const canvas = options.format === ChartFormat.Png
    ? createCanvas(
        options.width * options.pixelRatio,
        options.height * options.pixelRatio
      )
    : null
  const chart = echarts.init(
    canvas as unknown as Parameters<typeof echarts.init>[0],
    theme,
    {
      renderer: options.format === ChartFormat.Svg ? 'svg' : 'canvas',
      ssr: true,
      width: options.width,
      height: options.height,
      devicePixelRatio: options.pixelRatio
    }
  )

  try {
    // Options remain JSON configuration. Static exports never run animation
    // timers and render completely before their bytes are published.
    chart.setOption({ ...structuredClone(options.option), animation: false })

    const requestedSeries = options.option['series']
    const renderedSeries = chart.getOption()['series']
    const requestedCount = Array.isArray(requestedSeries)
      ? requestedSeries.length
      : 1

    // ECharts can warn and skip unknown series types instead of throwing.
    // Reject that incomplete rendering before it becomes a plausible artifact.
    if (
      !Array.isArray(renderedSeries) ||
      renderedSeries.length !== requestedCount
    ) {
      throw new Error(
        'Not all chart series could be rendered. Check the ECharts series types and options.'
      )
    }

    if (options.format === ChartFormat.Svg) {
      return Buffer.from(chart.renderToSVGString())
    }

    chart.getZr().refreshImmediately()

    return await canvas!.encode('png')
  } finally {
    chart.dispose()
  }
}
