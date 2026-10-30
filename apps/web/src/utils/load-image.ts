type ImagePriority = 'auto' | 'high' | 'low'

interface PendingImage {
  image: HTMLImageElement
  ready: Promise<HTMLImageElement>
}

const pendingImages = new Map<string, PendingImage>()

/**
 * Loads and decodes an image before display, sharing requests already in flight.
 */
export function loadImage(
  src: string,
  priority: ImagePriority = 'auto'
): Promise<HTMLImageElement> {
  const pending = pendingImages.get(src)

  if (pending !== undefined) {
    if (priority === 'high') {
      pending.image.fetchPriority = priority
    }

    return pending.ready
  }

  const image = new Image()

  image.decoding = 'async'
  image.fetchPriority = priority
  image.src = src

  const ready = image.decode().then(() => {
    return image
  }).finally(() => {
    pendingImages.delete(src)
  })

  pendingImages.set(src, { image, ready })

  return ready
}
