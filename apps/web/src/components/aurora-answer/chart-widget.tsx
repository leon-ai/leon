import type { ChartData } from '../../../../../aurora/src/v2/contracts/presentation'
import { ChartWidget } from '../../../../../aurora/src/v2/widgets/chart'
import { ExportableVisual } from '@/components/visual-export/visual-export'

async function createChart(element: HTMLElement, option: Record<string, unknown>) {
  const { chartEngine } = await import('../../../../../aurora/src/v2/widgets/chart-engine')

  return chartEngine.create(element, option)
}

async function canvasImages(element: HTMLElement): Promise<ReadonlyMap<HTMLCanvasElement, string>> {
  const { chartEngine } = await import('../../../../../aurora/src/v2/widgets/chart-engine')

  return chartEngine.snapshots(element)
}

/**
 * Loads the shared engine only when an answer actually contains a chart.
 */
export default function NativeChartWidget(props: ChartData & { onReady?: () => void }) {
  return <ExportableVisual canvasImages={canvasImages}><ChartWidget {...props} createChart={createChart} /></ExportableVisual>
}
