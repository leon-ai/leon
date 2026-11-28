import { useEffect, useRef } from 'react'
import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'
import { Button } from '@/components/button'
import { CopyButton } from '@/components/copy-button'
import { ImageDimensionsError } from '@/components/visual-export/rasterize-image'
import { getArtifactDownloadFilename } from '../../../../../server/src/core/artifacts/artifact-types'
import { copyArtifact } from './artifact-clipboard'
import { ArtifactSizeError, isTextArtifact } from './artifact-resource'

/**
 * Offers native image/text clipboard data and direct downloads, without
 * presenting a copied URL as a copied file attachment.
 */
export function ArtifactActions({ item }: { item: ArtifactItem }) {
  const image = item.mimeType.startsWith('image/')
  const canCopy = image || isTextArtifact(item)
  // Local documents have not passed server validation. Keep their previews
  // escaped; the authenticated stored file supplies the eventual Open action.
  const canOpen = !image && !item.mimeType.startsWith('video/') && !item.mimeType.startsWith('audio/') &&
    new URL(item.url, location.href).protocol !== 'blob:'
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [item.url])

  function copy(): Promise<void> {
    controller.current?.abort()
    const operation = new AbortController()
    controller.current = operation

    return copyArtifact(item, operation.signal).finally(() => operation.abort())
  }

  function copyErrorDescription(error: unknown): string {
    if (error instanceof ArtifactSizeError || error instanceof ImageDimensionsError) {
      return image ? 'This image is too large to copy. Use Download to get the full-resolution image.'
        : 'This file is too large to copy. Use Download to get the original file.'
    }

    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        return 'The browser blocked access to the clipboard. Try again or use Download instead.'
      }
      if (error.name === 'NotSupportedError') {
        return 'This browser doesn’t support copying this file. Use Download instead.'
      }
    }

    return 'Try again or use Download instead.'
  }

  return <span className="artifact-actions">
    {canCopy && <CopyButton onCopy={copy} iconName={image ? 'multi-image' : 'file-copy'} tone="muted"
      label={image ? 'Copy image' : 'Copy contents'} errorTitle={image ? 'I couldn’t copy this image' : 'I couldn’t copy this file'}
      errorDescription={copyErrorDescription} />}
    {canOpen &&
      <Button href={item.url} target="_blank" rel="noopener noreferrer" iconName="eye" tone="muted" tooltipMessage="Open" />}
    <Button href={item.downloadUrl ?? item.url} download={getArtifactDownloadFilename(item.filename)} iconName="download" tone="muted" tooltipMessage="Download" />
  </span>
}
