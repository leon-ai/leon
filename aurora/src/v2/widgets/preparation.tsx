import { Button } from '../components/button/button'
import { Progress } from '../components/progress'
import { Surface } from '../components/surface'
import { PreparationStatus } from '../contracts/preparation'
export { PreparationStatus } from '../contracts/preparation'

export interface PreparationWidgetProps {
  title: string
  status: PreparationStatus
  detail: string
  completed?: number
  total?: number
  onCancel?: () => void
  onRetry?: () => void
  cancelling?: boolean
}

/**
 * Presents host-reported preparation state without estimating or simulating progress.
 */
export function PreparationWidget({ title, status, detail, completed, total, onCancel, onRetry, cancelling = false }: PreparationWidgetProps) {
  const active = status === PreparationStatus.Preparing || status === PreparationStatus.Downloading

  return <Surface title={title} footer={active && onCancel ?
    <Button variant="secondary" loading={cancelling} onClick={onCancel}>Cancel</Button> :
    status === PreparationStatus.Failed && onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}>
    <div role={status === PreparationStatus.Failed ? 'alert' : 'status'} aria-live="polite">
      {active ? <Progress label={detail}
        {...(completed !== undefined && total !== undefined && total > 0 ? { value: completed, max: total } : {})}
      /> : <p className="aurora-feedback">{detail}</p>}
    </div>
  </Surface>
}
