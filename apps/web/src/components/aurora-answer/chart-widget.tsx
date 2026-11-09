import type { ChartData } from '../../../../../aurora/src/v2/contracts/presentation'
import { ChartWidget } from '../../../../../aurora/src/v2/widgets/chart'

async function createChart(element: HTMLElement, option: Record<string, unknown>) {
  const { chartEngine } = await import('../../../../../aurora/src/v2/widgets/chart-engine')

  return chartEngine.create(element, option)
}

/**
 * Loads the shared engine only when an answer actually contains a chart.
 */
export default function NativeChartWidget(props: ChartData & { onReady?: () => void }) {
  return <ChartWidget {...props} createChart={createChart} />
}
