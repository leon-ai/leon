import { toSvg } from 'html-to-image'
import { isBoundedPNG, MAXIMUM_IMAGE_EDGE, MAXIMUM_IMAGE_PIXELS } from './image-contract'

const MAXIMUM_CAPTURE_NODES = 10_000
const MAXIMUM_SNAPSHOT_CHARACTERS = 16_777_216

async function rasterize(svg: string, width: number, height: number, pixelRatio: number): Promise<Blob> {
  const image = new Image()
  image.src = svg
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(width * pixelRatio)
  canvas.height = Math.floor(height * pixelRatio)
  try {
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)

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
    // Release the backing pixels even if encoding fails or a caller disappears.
    canvas.width = 0
    canvas.height = 0
    image.src = ''
  }
}

/**
 * Captures a bounded, local snapshot without fetching external assets or fonts.
 * The caller supplies trusted embedded fonts, including inside an opaque frame.
 */
export async function captureImage(element: HTMLElement, fontEmbedCSS: string,
  canvasImages?: () => ReadonlyMap<HTMLCanvasElement, string>): Promise<Blob> {
  if (!element.isConnected || element.querySelectorAll('*').length > MAXIMUM_CAPTURE_NODES) {
    throw new Error('This visual is too large to export.')
  }

  const width = Math.ceil(Math.max(element.scrollWidth, element.getBoundingClientRect().width))
  const height = Math.ceil(Math.max(element.scrollHeight, element.getBoundingClientRect().height))
  if (!width || !height || width > MAXIMUM_IMAGE_EDGE || height > MAXIMUM_IMAGE_EDGE ||
    width * height > MAXIMUM_IMAGE_PIXELS) {
    throw new Error('This visual is too large to export.')
  }

  await document.fonts.ready
  const replacements = new Map([...canvasImages?.() ?? []].map(([canvas, image]) => [canvas.toDataURL(), image]))
  const pixelRatio = Math.min(2, MAXIMUM_IMAGE_EDGE / width, MAXIMUM_IMAGE_EDGE / height,
    Math.sqrt(MAXIMUM_IMAGE_PIXELS / (width * height)))
  const source = await toSvg(element, {
    width, height, pixelRatio, fontEmbedCSS,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim(),
    style: { width: `${width}px`, height: `${height}px`, maxHeight: 'none', maxWidth: 'none', overflow: 'visible', margin: '0' },
    // Abort any resource request before dispatch. Captures use already embedded
    // assets only, never contact sites mentioned in a conversation.
    fetchRequestInit: { signal: AbortSignal.abort() },
    filter: (node) => {
      if (!(node instanceof Element)) {
        return true
      }
      if (node.hasAttribute('data-image-export-ignore') ||
        ['SCRIPT', 'STYLE', 'LINK', 'IFRAME'].includes(node.tagName) ||
        (node instanceof HTMLInputElement && node.type === 'password')) {
        return false
      }

      return !(node instanceof HTMLImageElement) || node.src.startsWith('data:')
    }
  })
  if (source.length > MAXIMUM_SNAPSHOT_CHARACTERS) {
    throw new Error('This visual is too large to export.')
  }
  const snapshot = new DOMParser().parseFromString(decodeURIComponent(source.slice(source.indexOf(',') + 1)), 'image/svg+xml')
  // Native checked properties are not reflected in HTML attributes. Mirror
  // them only in the detached snapshot, leaving the live interface untouched.
  const inputs = [...element.querySelectorAll('input')].filter((input) => input.type !== 'password' &&
    !input.closest('[data-image-export-ignore]'))
  const copies = [...snapshot.getElementsByTagName('input')]
  for (const [index, input] of inputs.entries()) {
    const copy = copies[index]
    if (copy && (input.type === 'checkbox' || input.type === 'radio')) {
      copy.toggleAttribute('checked', input.checked)
    }
  }
  for (const image of snapshot.getElementsByTagName('img')) {
    const replacement = replacements.get(image.getAttribute('src') ?? '')
    if (replacement) {
      image.setAttribute('src', replacement)
    }
  }
  const svg = new XMLSerializer().serializeToString(snapshot.documentElement)
  if (svg.length > MAXIMUM_SNAPSHOT_CHARACTERS) {
    throw new Error('This visual is too large to export.')
  }
  const blob = await rasterize(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width, height, pixelRatio)
  if (!blob || !isBoundedPNG(new Uint8Array(await blob.arrayBuffer()))) {
    throw new Error('I couldn’t create an image of this visual.')
  }

  return blob
}
