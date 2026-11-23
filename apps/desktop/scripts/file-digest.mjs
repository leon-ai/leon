import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * Verifies large installer payloads with bounded memory.
 */
export async function fileDigest(filename, algorithm, encoding = 'hex') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest(encoding)
}
