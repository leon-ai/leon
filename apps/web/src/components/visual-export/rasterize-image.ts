import { MAXIMUM_IMAGE_EDGE, MAXIMUM_IMAGE_PIXELS } from './image-contract'

/**
 * Encodes decoded artwork as a bounded PNG, releasing canvas memory afterwards.
 */
export async function rasterizeImage(image: HTMLImageElement, width: number, height: number): Promise<Blob> {
  if (!width || !height || width > MAXIMUM_IMAGE_EDGE || height > MAXIMUM_IMAGE_EDGE || width * height > MAXIMUM_IMAGE_PIXELS) {
    throw new Error('This image is too large to copy. Use Download instead.')
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
