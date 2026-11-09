import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { ArtifactWidget } from '../../../../../aurora/src/v2/widgets/artifacts'
import { VisualPreview } from '@/components/visual-preview/visual-preview'
import { FileIcon } from '@/components/icon'

const PREVIEW_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'
])

/**
 * Displays the same portable artifact contract consumed by external clients.
 */
export function ArtifactAttachments({ artifacts, title = 'Files' }: { artifacts: Artifact[], title?: string }) {
  const items = artifacts.filter((artifact) => artifact.url ===
    `/api/v1/artifacts/${encodeURIComponent(artifact.session_id)}/${encodeURIComponent(artifact.id)}`).map((artifact) => ({
    id: artifact.id, filename: artifact.filename,
    // Unrecognized formats stay downloadable, never embedded as active content.
    mimeType: PREVIEW_MIME_TYPES.has(artifact.mime_type) ? artifact.mime_type : 'application/octet-stream',
    url: artifact.url, downloadUrl: `${artifact.url}?download=true`,
    sizeLabel: `${Math.ceil(artifact.size_bytes / 1_024)} KB`
  }))

  if (!items.length) {
    return null
  }

  return <ArtifactWidget title={title} items={items}
    renderFileIcon={(filename) => <FileIcon fileName={filename} />}
    renderImagePreview={(item, image) => <VisualPreview title={item.filename}>{image}</VisualPreview>} />
}
