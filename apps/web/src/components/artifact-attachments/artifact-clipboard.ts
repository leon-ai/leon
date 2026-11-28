import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'
import { fitsImageDimensions, PNG_HEADER_BYTES, readPNGDimensions } from '@/components/visual-export/image-contract'
import { rasterizeImage } from '@/components/visual-export/rasterize-image'
import { ARTIFACT_TEXT_COPY_BYTES, ArtifactSizeError, isTextArtifact, readArtifactResource } from './artifact-resource'

// Screenshot-shaped attachments need a longer edge, while the pixel cap bounds canvas memory.
const ARTIFACT_IMAGE_COPY_BYTES = 16_777_216
const ARTIFACT_IMAGE_DIMENSION_LIMITS = { edge: 16_384, pixels: 16_000_000 }

async function png(item: ArtifactItem, signal: AbortSignal): Promise<Blob> {
  const { blob } = await readArtifactResource(item, ARTIFACT_IMAGE_COPY_BYTES, signal)

  if (blob.type === 'image/png') {
    const dimensions = readPNGDimensions(new Uint8Array(await blob.slice(0, PNG_HEADER_BYTES).arrayBuffer()))
    if (!dimensions) {
      throw new Error('This PNG has an invalid header.')
    }

    if (!fitsImageDimensions(dimensions.width, dimensions.height, ARTIFACT_IMAGE_DIMENSION_LIMITS)) {
      throw new ArtifactSizeError('This image is too large to copy.')
    }

    return blob
  }

  const url = URL.createObjectURL(blob)
  const image = new Image()

  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()

    const result = await rasterizeImage(image, image.naturalWidth, image.naturalHeight, ARTIFACT_IMAGE_DIMENSION_LIMITS)
    if (result.size > ARTIFACT_IMAGE_COPY_BYTES) {
      throw new ArtifactSizeError('This image is too large to copy.')
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
    throw new DOMException('This browser cannot copy this format.', 'NotSupportedError')
  }

  const resource = image ? png(item, signal) : readArtifactResource(item, ARTIFACT_TEXT_COPY_BYTES, signal)
    .then(async ({ blob }) => new Blob([await blob.text()], { type }))
  const data = resource.then((blob) => {
    signal.throwIfAborted()

    return blob
  })
  // Safari needs activation before the fetch completes. Observe the data error
  // directly because the clipboard API can replace it with a browser error.
  void data.catch(() => undefined)
  await Promise.all([data, navigator.clipboard.write([new ClipboardItem({ [type]: data })])])
}
