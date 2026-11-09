export const MAXIMUM_IMAGE_BYTES = 8_388_608
export const MAXIMUM_IMAGE_PIXELS = 8_388_608
export const MAXIMUM_IMAGE_EDGE = 8_192
export const IMAGE_EXPORT_TIMEOUT_MS = 15_000
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/**
 * Checks encoded dimensions before an untrusted frame image reaches a decoder.
 */
export function isBoundedPNG(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || bytes.length > MAXIMUM_IMAGE_BYTES ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return false
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = header.getUint32(16)
  const height = header.getUint32(20)

  return header.getUint32(8) === 13 && header.getUint32(12) === 0x49484452 &&
    width > 0 && height > 0 && width <= MAXIMUM_IMAGE_EDGE && height <= MAXIMUM_IMAGE_EDGE &&
    width * height <= MAXIMUM_IMAGE_PIXELS
}
