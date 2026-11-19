const UUID_BYTE_LENGTH = 16

/**
 * Generates a UUID v4 for browser IDs, including when Leon is served over LAN HTTP.
 */
export function createUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTE_LENGTH))

  // Preserve the random bits outside the UUID v4 version and variant fields.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}
