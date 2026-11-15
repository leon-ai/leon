import { lazy, Suspense } from 'react'
import { ArtifactWidget, ArtifactCard, type ArtifactItem, type ArtifactWidgetProps } from '../../../../../aurora/src/v2/widgets/artifacts'
import { useNearViewport } from '../../../../../aurora/src/v2/hooks/use-near-viewport'
import { FileIcon } from '@/components/icon'
import { VisualPreview } from '@/components/visual-preview/visual-preview'
import { ArtifactActions } from './artifact-actions'
import { isTextArtifact } from './artifact-resource'

import './artifact-files.sass'

const ArtifactTextPreview = lazy(() => import('./artifact-text-preview'))

function DocumentPreview({ item }: { item: ArtifactItem }) {
  const { ref, visible } = useNearViewport<HTMLDivElement>()

  return <div className="artifact-document-preview" ref={ref}>
    {visible && <Suspense fallback={null}><ArtifactTextPreview item={item} /></Suspense>}
  </div>
}

const FILE_RENDERERS: Pick<ArtifactWidgetProps, 'renderFileIcon' | 'renderImagePreview' | 'renderMediaPreview' | 'renderDocumentPreview' | 'renderActions'> = {
  renderFileIcon: (filename) => <FileIcon fileName={filename} />,
  renderImagePreview: (item, image) => <VisualPreview title={item.filename} fullWidth>{image}</VisualPreview>,
  renderMediaPreview: (item, thumbnail, player) => <VisualPreview title={item.filename}
    label={`Play ${item.filename}`} preview={thumbnail} interactive fullWidth>{player}</VisualPreview>,
  renderDocumentPreview: (item) => isTextArtifact(item) ? <DocumentPreview key={item.url} item={item} /> : null,
  renderActions: (item) => <ArtifactActions key={item.url} item={item} />
}

/**
 * Supplies the same host preview and actions to individual owner file tiles.
 */
export function ArtifactFile({ item, compact = false, previewOnly = false }: { item: ArtifactItem, compact?: boolean, previewOnly?: boolean }) {
  return <ArtifactCard item={item} compact={compact} previewOnly={previewOnly} {...FILE_RENDERERS} />
}

/**
 * Keeps browser-only file operations outside Aurora's portable card layout.
 * Runtime answers and the Files gallery share these exact media and actions.
 */
export function ArtifactFiles(props: Pick<ArtifactWidgetProps, 'title' | 'description' | 'items'>) {
  return <ArtifactWidget {...props} {...FILE_RENDERERS} />
}
