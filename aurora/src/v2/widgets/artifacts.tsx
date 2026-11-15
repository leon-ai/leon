import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Surface } from '../components/surface'
import { useNearViewport } from '../hooks/use-near-viewport'

import './artifacts.sass'

const RESOURCE_PROTOCOLS = new Set(['http:', 'https:', 'blob:'])
const RELATIVE_RESOURCE_BASE = 'https://aurora.invalid'
const VIDEO_PREVIEW_TIME_SECONDS = .001

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
  renderActions?: (item: ArtifactItem) => ReactNode
  renderDocumentPreview?: (item: ArtifactItem) => ReactNode
  renderMediaPreview?: (item: ArtifactItem, thumbnail: ReactNode, player: ReactNode) => ReactNode
}

function ArtifactVideo({ url, filename, controls = true, allowDownload = true }: {
  url: string
  filename: string
  controls?: boolean
  allowDownload?: boolean
}) {
  const { ref, visible } = useNearViewport<HTMLVideoElement>()

  // Metadata loading is viewport-gated; playback always remains owner initiated.
  return <video ref={ref} src={url} controls={controls} controlsList={allowDownload ? undefined : 'nodownload'}
    playsInline preload={visible ? 'metadata' : 'none'} aria-label={filename}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget
      // Seeking just inside the stream paints a first-frame thumbnail on browsers
      // that initially show an empty video surface after loading metadata.
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime === 0) {
        video.currentTime = Math.min(VIDEO_PREVIEW_TIME_SECONDS, video.duration / 2)
      }
    }} />
}

function safeResourceURL(value: string): string | undefined {
  try {
    const url = new URL(value, RELATIVE_RESOURCE_BASE)

    return RESOURCE_PROTOCOLS.has(url.protocol) ? value : undefined
  } catch {
    return undefined
  }
}

export interface ArtifactCardProps extends Pick<ArtifactWidgetProps,
  'renderFileIcon' | 'renderImagePreview' | 'renderActions' | 'renderDocumentPreview' | 'renderMediaPreview'> {
  item: ArtifactItem
  compact?: boolean
  previewOnly?: boolean
}

/**
 * Shares media loading, URL policy and file actions across answer cards and
 * compact owner attachments. Authorization and resource lifetime stay host-owned.
 */
export function ArtifactCard({
  item,
  compact = false,
  previewOnly = false,
  renderFileIcon,
  renderImagePreview,
  renderActions,
  renderDocumentPreview,
  renderMediaPreview
}: ArtifactCardProps) {
  const url = safeResourceURL(item.url)
  const downloadUrl = safeResourceURL(item.downloadUrl ?? item.url)
  if (!url || !downloadUrl) {
    return null
  }
  const image = item.mimeType.startsWith('image/')
  const video = item.mimeType.startsWith('video/')
  const audio = item.mimeType.startsWith('audio/')
  const documentPreview = !image && !video && !audio ? renderDocumentPreview?.(item) : null
  const imageContent = image ? <img src={url} alt={item.filename} loading="lazy" decoding="async" draggable={false} /> : null
  const player = video ? <ArtifactVideo url={url} filename={item.filename} allowDownload={!previewOnly} />
    : audio ? <audio src={url} controls controlsList={previewOnly ? 'nodownload' : undefined} preload="none" aria-label={item.filename} /> : null
  const thumbnail = video ? <ArtifactVideo url={url} filename={item.filename} controls={false} />
    : <span className="aurora-artifact-placeholder" aria-hidden="true">{renderFileIcon(item.filename)}</span>

  return <figure className={clsx('aurora-artifact', {
    'aurora-artifact-compact': compact,
    'aurora-artifact-preview-only': previewOnly,
    'aurora-artifact-document': !image && !video
  })} aria-label={previewOnly ? item.filename : undefined}>
    {image && <div className="aurora-artifact-preview">
      {renderImagePreview ? renderImagePreview(item, imageContent) : <a href={url} target="_blank" rel="noreferrer" className="aurora-artifact-image">{imageContent}</a>}
    </div>}
    {(video || audio) && (compact
      ? <div className="aurora-artifact-media">{renderMediaPreview ? renderMediaPreview(item, thumbnail, player) : player}</div>
      : player)}
    {documentPreview}
    {compact && !image && !video && !audio && !documentPreview && thumbnail}
    <figcaption>
      <span className="aurora-artifact-icon" aria-hidden="true">{renderFileIcon(item.filename)}</span>
      <span className="aurora-artifact-name">{item.filename}{!previewOnly && item.sizeLabel && <small>{item.sizeLabel}</small>}</span>
      {!previewOnly && (renderActions ? renderActions(item) : <>
        {!image && !video && !audio && <a href={url} target="_blank" rel="noreferrer">Open</a>}
        <a href={downloadUrl} download={item.filename}>Download</a>
      </>)}
    </figcaption>
  </figure>
}

/**
 * Places host-owned media and document references inside a visual answer.
 * File authorization stays with the host; model-generated paths are not resolved here.
 */
export function ArtifactWidget({ title, description, items, ...renderers }: ArtifactWidgetProps) {
  return <Surface title={title} {...(description === undefined ? {} : { description })}>
    <div className="aurora-artifacts">
      {items.map((item) => <ArtifactCard key={item.id} item={item} {...renderers} />)}
    </div>
  </Surface>
}
