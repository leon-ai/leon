import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * Separates update receipts for checkouts sharing the same Leon home.
 */
export function getUpdateStatePath(leonHome, codebase, runtimeHome = process.env.LEON_RUNTIME_HOME) {
  const root = fs.realpathSync(path.resolve(runtimeHome || codebase))
  const key = createHash('sha256').update(root).digest('hex')

  return path.join(leonHome, 'updates', key, 'state.json')
}
