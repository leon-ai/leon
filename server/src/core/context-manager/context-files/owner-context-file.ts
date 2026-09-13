import fs from 'node:fs'

import { ContextFile } from '@/core/context-manager/context-file'
import {
  buildOwnerDocument,
  buildOwnerManifest,
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
        const document = fs.readFileSync(ownerContextPath, 'utf8').trimEnd()
        const manifest = `> ${buildOwnerManifest(readOwnerProfileSync())}`
        // Refresh the summary without rewriting the owner's curated document body.
        const firstLineEnd = document.indexOf('\n')
        const body = document.startsWith('>')
          ? (firstLineEnd === -1 ? '' : document.slice(firstLineEnd + 1))
          : document
        return `${manifest}\n${body}`
      } catch {
        // Fall back to the derived skeleton below.
      }
    }

    return buildOwnerDocument(readOwnerProfileSync())
  }
}
