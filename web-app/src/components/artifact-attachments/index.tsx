import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'

/**
 * Displays the same portable artifact contract consumed by external clients.
 */
export function ArtifactAttachments({ artifacts }: { artifacts: Artifact[] }) {
  return (
    <div className="artifact-attachments">
      {artifacts.map((artifact) => {
        const expected = `/api/v1/artifacts/${encodeURIComponent(artifact.session_id)}/${encodeURIComponent(artifact.id)}`

        if (artifact.url !== expected) {
          return null
        }

        const image = [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif'
        ].includes(artifact.mime_type)
        const video = ['video/mp4', 'video/webm'].includes(artifact.mime_type)
        const audio = [
          'audio/mpeg',
          'audio/wav',
          'audio/ogg',
          'audio/mp4'
        ].includes(artifact.mime_type)

        return (
          <figure key={artifact.id}>
            {image && (
              <img
                src={artifact.url}
                alt={artifact.filename}
                loading="lazy"
                style={{ maxWidth: '100%', maxHeight: 480 }}
              />
            )}
            {video && (
              <video
                src={artifact.url}
                controls
                preload="metadata"
                style={{ maxWidth: '100%', maxHeight: 480 }}
              />
            )}
            {audio && <audio src={artifact.url} controls preload="metadata" />}
            <figcaption>
              <a
                href={`${artifact.url}?download=true`}
                download={artifact.filename}
              >
                {artifact.filename} · {Math.ceil(artifact.size_bytes / 1_024)}{' '}
                KB · Download
              </a>
              {artifact.mime_type === 'application/pdf' && (
                <a href={artifact.url} target="_blank" rel="noreferrer">
                  {' '}
                  Open PDF
                </a>
              )}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
