import { Button } from '@/components/button'
import { ArtifactFile } from '@/components/artifact-attachments/artifact-files'
import { Progress } from '../../../../../aurora/src/v2/components/progress'
import { AttachmentUploadState, type AttachmentUploadProgress } from '@/data/owner-attachments'

export { AttachmentDropZone } from './attachment-drop-zone'

import './attachment-previews.sass'

export interface AttachmentPreview {
  id: string
  filename: string
  mediaType: string
  url: string
}

/**
 * Shares compact attachment artwork between the composer and saved owner turns.
 */
export function AttachmentPreviews({ items, onRemove, disabled = false, uploads }: {
  items: AttachmentPreview[]
  onRemove?: (id: string) => void
  disabled?: boolean
  uploads?: Record<string, AttachmentUploadProgress>
}) {
  return <ul className="attachment-previews" aria-label="Attached files">
    {items.map((item) => <li className="attachment-preview" key={item.id}>
      <ArtifactFile item={{ id: item.id, filename: item.filename, mimeType: item.mediaType, url: item.url }} compact previewOnly />
      {uploads?.[item.id] && <AttachmentUploadStatus filename={item.filename} progress={uploads[item.id]!} />}
      {onRemove && <Button className="attachment-preview-remove" size="sm" iconName="close"
        ariaLabel={`Remove ${item.filename}`} disabled={disabled} onClick={() => onRemove(item.id)} />}
    </li>)}
  </ul>
}

function AttachmentUploadStatus({ filename, progress }: { filename: string, progress: AttachmentUploadProgress }) {
  return <div className="attachment-upload-status" role="group" aria-label={`Upload status for ${filename}`}>
    {progress.state === AttachmentUploadState.Uploading
      ? <Progress label="Uploading" showLabel={false} value={progress.loaded} max={progress.total} />
      : progress.state === AttachmentUploadState.Processing
        ? <Progress label="Processing" />
        : <span role="status">{progress.state === AttachmentUploadState.Complete ? 'Uploaded'
          : progress.state === AttachmentUploadState.Failed ? 'Upload failed' : 'Queued'}</span>}
  </div>
}
