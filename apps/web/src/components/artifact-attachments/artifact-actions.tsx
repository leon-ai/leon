import { useEffect, useRef } from 'react'
import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { getArtifactDownloadFilename } from '../../../../../server/src/core/artifacts/artifact-types'
import { copyArtifact } from './artifact-clipboard'
import { isTextArtifact } from './artifact-resource'

/**
 * Offers native image/text clipboard data and direct downloads, without
 * presenting a copied URL as a copied file attachment.
 */
export function ArtifactActions({ item }: { item: ArtifactItem }) {
  const image = item.mimeType.startsWith('image/')
  const canCopy = image || isTextArtifact(item)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [item.url])

  function copy(): Promise<void> {
    controller.current?.abort()
    controller.current = new AbortController()

    return copyArtifact(item, controller.current.signal)
  }

  return <span className="artifact-actions">
    {canCopy && <CopyButton onCopy={copy} iconName={image ? 'multi-image' : 'file-copy'} tone="muted"
      label={image ? 'Copy image' : 'Copy contents'} errorTitle="I couldn’t copy this file"
      errorDescription="Your browser may not support copying this file, or the file may be too large. Use Download instead." />}
    {!image && !item.mimeType.startsWith('video/') && !item.mimeType.startsWith('audio/') &&
      <Button href={item.url} target="_blank" rel="noopener noreferrer" iconName="eye" tone="muted" tooltipMessage="Open" />}
    <Button href={item.downloadUrl ?? item.url} download={getArtifactDownloadFilename(item.filename)} iconName="download" tone="muted" tooltipMessage="Download" />
  </span>
}
