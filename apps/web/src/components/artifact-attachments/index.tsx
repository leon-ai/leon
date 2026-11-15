import type { Artifact } from '../../../../../server/src/core/artifacts/artifact-types'
import { formatBytes } from '../../../../../aurora/src/v2/utils/format-bytes'
import { ArtifactFiles } from './artifact-files'

/**
 * Displays the same portable artifact contract consumed by external clients.
 */
export function ArtifactAttachments({ artifacts, title = 'Files' }: { artifacts: Artifact[], title?: string }) {
  const items = artifacts.filter((artifact) => artifact.url ===
    `/api/v1/artifacts/${encodeURIComponent(artifact.session_id)}/${encodeURIComponent(artifact.id)}`).map((artifact) => ({
    id: artifact.id, filename: artifact.filename,
    // Previews use isolated media elements or escaped text, never active
    // document frames or injected markup.
    mimeType: artifact.mime_type,
    url: artifact.url, downloadUrl: `${artifact.url}?download=true`,
    sizeLabel: formatBytes(artifact.size_bytes)
  }))

  if (!items.length) {
    return null
  }

  return <ArtifactFiles title={title} items={items} />
}
