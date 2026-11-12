import { Button } from '../components/button/button'
import { Progress } from '../components/progress'
import { Surface } from '../components/surface'
import { ScrollContainer } from '../components/scroll-container'
import { Badge, type BadgeVariant } from '../components/badge/badge'
import { PreparationStatus } from '../contracts/preparation'
import { DurationFormat, formatDuration } from '../utils/format-duration'
import type { DownloadStatus, FileDownloadProgress } from '../../../../bridges/runtime/contracts/download-progress'
export { PreparationStatus } from '../contracts/preparation'

import './preparation.sass'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const BYTES_PER_UNIT = 1_024
const ETA_RESOLUTION_MS = 1_000
const DOWNLOAD_BADGES: Record<Exclude<DownloadStatus, 'downloading'>, { label: string, variant: BadgeVariant }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  complete: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'secondary' }
}

function formatDownloadSize(bytes: number): string {
  const unit = Math.min(BYTE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(bytes || 1) / Math.log(BYTES_PER_UNIT))))

  return `${Number((bytes / BYTES_PER_UNIT ** unit).toFixed(2))} ${BYTE_UNITS[unit]}`
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
              <Badge {...DOWNLOAD_BADGES[file.status]} />
            </div>}
            {file.status !== 'queued' && <p className="aurora-feedback">
              {formatDownloadSize(file.downloadedBytes)}{file.totalBytes !== null ? ` / ${formatDownloadSize(file.totalBytes)}` : ''}
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
