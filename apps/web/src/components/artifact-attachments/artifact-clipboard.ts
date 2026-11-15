import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'
import { MAXIMUM_IMAGE_BYTES, isBoundedPNG } from '@/components/visual-export/image-contract'
import { rasterizeImage } from '@/components/visual-export/rasterize-image'
import { ARTIFACT_TEXT_COPY_BYTES, isTextArtifact, readArtifactResource } from './artifact-resource'

async function png(item: ArtifactItem, signal: AbortSignal): Promise<Blob> {
  const { blob } = await readArtifactResource(item, MAXIMUM_IMAGE_BYTES, signal)
  if (blob.type === 'image/png') {
    if (!isBoundedPNG(new Uint8Array(await blob.arrayBuffer()))) {
      throw new Error('This image is too large or unavailable. Use Download instead.')
    }
    return blob
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()

  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()

    const result = await rasterizeImage(image, image.naturalWidth, image.naturalHeight)
    if (result.size > MAXIMUM_IMAGE_BYTES) {
      throw new Error('This image is too large to copy. Use Download instead.')
    }

    return result
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}

/**
 * Writes supported native clipboard formats during the original user gesture.
 * Binary documents are never misrepresented as copied file attachments.
 */
export async function copyArtifact(item: ArtifactItem, signal: AbortSignal): Promise<void> {
  const image = item.mimeType.startsWith('image/')
  const type = image ? 'image/png' : 'text/plain'
  if (!image && !isTextArtifact(item)) {
    throw new Error('Use Download for this format.')
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined' ||
    ClipboardItem.supports && !ClipboardItem.supports(type)) {
    throw new Error('This browser cannot copy this format. Use Download instead.')
  }

  const resource = image ? png(item, signal) : readArtifactResource(item, ARTIFACT_TEXT_COPY_BYTES, signal)
    .then(async ({ blob }) => new Blob([await blob.text()], { type }))
  const data = resource.then((blob) => {
    signal.throwIfAborted()

    return blob
  })
  // Safari needs activation before the fetch completes. Handle permission
  // rejection even if the browser never consumes the pending data promise.
  void data.catch(() => undefined)
  await navigator.clipboard.write([new ClipboardItem({ [type]: data })])
}
