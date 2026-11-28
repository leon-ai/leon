export const MAXIMUM_IMAGE_BYTES = 8_388_608
export const MAXIMUM_IMAGE_PIXELS = 8_388_608
export const MAXIMUM_IMAGE_EDGE = 8_192
export const IMAGE_EXPORT_TIMEOUT_MS = 15_000
export const PNG_HEADER_BYTES = 33
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const DEFAULT_IMAGE_DIMENSION_LIMITS = { edge: MAXIMUM_IMAGE_EDGE, pixels: MAXIMUM_IMAGE_PIXELS }

export interface ImageDimensionLimits {
  edge: number
  pixels: number
}

/**
 * Bounds each canvas dimension and the total decoded pixel area.
 */
export function fitsImageDimensions(
  width: number,
  height: number,
  limits: ImageDimensionLimits = DEFAULT_IMAGE_DIMENSION_LIMITS
): boolean {
  return width > 0 && height > 0 && width <= limits.edge && height <= limits.edge && width * height <= limits.pixels
}

/**
 * Reads intrinsic dimensions from the PNG header without decoding pixel data.
 */
export function readPNGDimensions(bytes: Uint8Array): { width: number, height: number } | undefined {
  if (bytes.length < PNG_HEADER_BYTES || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return undefined
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = header.getUint32(16)
  const height = header.getUint32(20)

  if (header.getUint32(8) === 13 && header.getUint32(12) === 0x49484452 && width > 0 && height > 0) {
    return { width, height }
  }

  return undefined
}

/**
 * Checks encoded dimensions before an untrusted frame image reaches a decoder.
 */
export function isBoundedPNG(bytes: Uint8Array): boolean {
  if (bytes.length > MAXIMUM_IMAGE_BYTES) {
    return false
  }

  const dimensions = readPNGDimensions(bytes)

  return dimensions !== undefined && fitsImageDimensions(dimensions.width, dimensions.height)
}
