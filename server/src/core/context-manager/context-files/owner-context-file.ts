import fs from 'node:fs'

import { ContextFile } from '@/core/context-manager/context-file'
import {
  buildOwnerDocument,
  getOwnerContextPath,
  readOwnerProfileSync
} from '@/core/context-manager/owner-profile'

export const OWNER_CONTEXT_TTL_MS: number | null = null

export class OwnerContextFile extends ContextFile {
  public readonly filename = 'OWNER.md'
  public readonly ttlMs: number | null

  public constructor(ttlMs: number | null) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const ownerContextPath = getOwnerContextPath()

    if (fs.existsSync(ownerContextPath)) {
      try {
        return fs.readFileSync(ownerContextPath, 'utf8').trimEnd()
      } catch {
        // Fall back to the derived skeleton below.
      }
    }

    return buildOwnerDocument(readOwnerProfileSync())
  }
}
