import { fitsImageDimensions, type ImageDimensionLimits } from './image-contract'

/**
 * Identifies a canvas allocation rejected by the image dimensions budget.
 */
export class ImageDimensionsError extends Error {}

/**
 * Encodes decoded artwork as a bounded PNG, releasing canvas memory afterwards.
 */
export async function rasterizeImage(
  image: HTMLImageElement,
  width: number,
  height: number,
  limits?: ImageDimensionLimits
): Promise<Blob> {
  if (!fitsImageDimensions(width, height, limits)) {
    throw new ImageDimensionsError('This image is too large to rasterize.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  try {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Image conversion is not available.')
    }
    context.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('I couldn’t encode this image.'))
        }
      }, 'image/png')
    })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
