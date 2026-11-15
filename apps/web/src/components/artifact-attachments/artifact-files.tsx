import { lazy, Suspense } from 'react'
import { ArtifactWidget, type ArtifactItem, type ArtifactWidgetProps } from '../../../../../aurora/src/v2/widgets/artifacts'
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

/**
 * Keeps browser-only file operations outside Aurora's portable card layout.
 * Runtime answers and the Files gallery share these exact media and actions.
 */
export function ArtifactFiles(props: Pick<ArtifactWidgetProps, 'title' | 'description' | 'items'>) {
  return <ArtifactWidget {...props}
    renderFileIcon={(filename) => <FileIcon fileName={filename} />}
    renderImagePreview={(item, image) => <VisualPreview title={item.filename} fullWidth>{image}</VisualPreview>}
    renderDocumentPreview={(item) => isTextArtifact(item) ? <DocumentPreview key={item.url} item={item} /> : null}
    renderActions={(item) => <ArtifactActions key={item.url} item={item} />} />
}
