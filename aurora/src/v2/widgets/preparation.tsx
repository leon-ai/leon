import { Button } from '../components/button/button'
import { Progress } from '../components/progress'
import { Surface } from '../components/surface'
import { ScrollContainer } from '../components/scroll-container'
import { Status, type StatusVariant } from '../components/status/status'
import { PreparationStatus } from '../contracts/preparation'
import { DurationFormat, formatDuration } from '../utils/format-duration'
import { formatBytes } from '../utils/format-bytes'
import type { DownloadStatus, FileDownloadProgress } from '../../../../bridges/runtime/contracts/download-progress'
export { PreparationStatus } from '../contracts/preparation'

import './preparation.sass'

const ETA_RESOLUTION_MS = 1_000
const DOWNLOAD_STATUSES: Record<Exclude<DownloadStatus, 'downloading'>, { label: string, variant: StatusVariant }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  complete: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'secondary' }
}

export interface PreparationWidgetProps {
  title: string
  status: PreparationStatus
  detail: string
  completed?: number
  total?: number
  downloads?: FileDownloadProgress[]
  onCancel?: () => void
  onRetry?: () => void
  cancelling?: boolean
}

/**
 * Presents host-reported preparation state without estimating or simulating progress.
 */
export function PreparationWidget({ title, status, detail, completed, total, downloads, onCancel, onRetry, cancelling = false }: PreparationWidgetProps) {
  const active = status === PreparationStatus.Preparing || status === PreparationStatus.Downloading

  return <Surface title={title} footer={active && onCancel ?
    <Button variant="secondary" loading={cancelling} onClick={onCancel}>Cancel</Button> :
    status === PreparationStatus.Failed && onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}>
    <div role={status === PreparationStatus.Failed ? 'alert' : 'status'} aria-live="polite">
      {downloads?.length ? <ScrollContainer className="aurora-downloads-scroll" tabIndex={0} role="region" aria-label="Download progress">
        <ul className="aurora-downloads" aria-label="Download files">
          {downloads.map((file) => <li key={file.id} className="aurora-download">
            {file.status === 'downloading' ? <Progress label={file.fileName}
              {...(file.totalBytes !== null && file.totalBytes > 0
                ? { value: file.downloadedBytes, max: file.totalBytes } : {})} /> : <div className="aurora-download-heading">
              <span className="aurora-download-name">{file.fileName}</span>
              <Status {...DOWNLOAD_STATUSES[file.status]} />
            </div>}
            {file.status !== 'queued' && <p className="aurora-feedback">
              {formatBytes(file.downloadedBytes)}{file.totalBytes !== null ? ` / ${formatBytes(file.totalBytes)}` : ''}
              {file.status === 'downloading' && file.etaMs !== null && file.etaMs > 0
                ? ` · ETA ${formatDuration(
                  Math.ceil(file.etaMs / ETA_RESOLUTION_MS) * ETA_RESOLUTION_MS,
                  DurationFormat.Compact
                )}` : ''}
            </p>}
            {file.error && <p className="aurora-feedback">{file.error}</p>}
          </li>)}
        </ul>
      </ScrollContainer> : active ? <Progress label={detail}
        {...(completed !== undefined && total !== undefined && total > 0 ? { value: completed, max: total } : {})}
      /> : <p className="aurora-feedback">{detail}</p>}
      {downloads?.length && (status === PreparationStatus.Failed || status === PreparationStatus.Cancelled) &&
        !downloads.some((file) => file.error) ? <p className="aurora-feedback">{detail}</p> : null}
    </div>
  </Surface>
}
