import type { ReactNode } from 'react'
import { Surface } from '../components/surface'

import './artifacts.sass'

const RESOURCE_PROTOCOLS = new Set(['http:', 'https:', 'blob:'])
const RELATIVE_RESOURCE_BASE = 'https://aurora.invalid'

export interface ArtifactItem {
  id: string
  filename: string
  mimeType: string
  url: string
  downloadUrl?: string
  sizeLabel?: string
}

export interface ArtifactWidgetProps {
  title: string
  description?: string
  items: readonly ArtifactItem[]
  renderFileIcon: (filename: string) => ReactNode
  renderImagePreview?: (item: ArtifactItem, image: ReactNode) => ReactNode
}

function safeResourceURL(value: string): string | undefined {
  try {
    const url = new URL(value, RELATIVE_RESOURCE_BASE)

    return RESOURCE_PROTOCOLS.has(url.protocol) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Places host-owned media and document references inside a visual answer.
 * File authorization stays with the host; model-generated paths are not resolved here.
 */
export function ArtifactWidget({ title, description, items, renderFileIcon, renderImagePreview }: ArtifactWidgetProps) {
  return <Surface title={title} {...(description === undefined ? {} : { description })}>
    <div className="aurora-artifacts">
      {items.map((item) => {
        const url = safeResourceURL(item.url)
        const downloadUrl = safeResourceURL(item.downloadUrl ?? item.url)

        if (!url || !downloadUrl) {
          return null
        }

        const image = item.mimeType.startsWith('image/')
        const video = item.mimeType.startsWith('video/')
        const audio = item.mimeType.startsWith('audio/')
        const imageContent = image ? <img src={url} alt={item.filename} loading="lazy" decoding="async" /> : null

        return <figure className="aurora-artifact" key={item.id}>
          {image && (renderImagePreview ? renderImagePreview(item, imageContent) : <a href={url} target="_blank" rel="noreferrer" className="aurora-artifact-image">{imageContent}</a>)}
          {video && <video src={url} controls preload="none" aria-label={item.filename} />}
          {audio && <audio src={url} controls preload="none" aria-label={item.filename} />}
          <figcaption>
            <span className="aurora-artifact-icon" aria-hidden="true">{renderFileIcon(item.filename)}</span>
            <span className="aurora-artifact-name">{item.filename}{item.sizeLabel && <small>{item.sizeLabel}</small>}</span>
            {!image && !video && !audio && <a href={url} target="_blank" rel="noreferrer">Open</a>}
            <a href={downloadUrl} download={item.filename}>Download</a>
          </figcaption>
        </figure>
      })}
    </div>
  </Surface>
}
