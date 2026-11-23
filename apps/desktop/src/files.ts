import { randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CreateReadStreamOptions, FileHandle } from 'node:fs/promises'
import type { ReadStream } from 'node:fs'
import type { FileGrants } from './types.js'

import contract from '../runtime/desktop-contract.mjs'

const GRANT_LIFETIME_MS = 30 * 60_000
const FILE_BUFFER_BYTES = 64 * 1_024

interface GrantedFile {
  path: string
  name: string
  size: number
  modified: number
  mediaType: string
  expires: number
}
interface OpenFile extends GrantedFile {
  handle: FileHandle
  stream: (options?: CreateReadStreamOptions) => ReadStream
}
interface FileStore {
  grant: (paths: string[]) => Promise<FileGrants>
  remove: (id: string) => void
  open: (id: string) => Promise<OpenFile>
}

/**
 * Owns bounded, expiring file references granted by native Paste. The renderer
 * receives opaque URLs; it cannot request arbitrary filesystem paths.
 */
export function createFileStore(): FileStore {
  const files = new Map<string, GrantedFile>()

  function prune(): void {
    const now = Date.now()
    for (const [id, file] of files) {
      if (file.expires <= now) {
        files.delete(id)
      }
    }
  }

  return {
    async grant(paths: string[]): Promise<FileGrants> {
      prune()
      const accepted: FileGrants['files'] = []
      const issues: string[] = []
      for (const input of paths.slice(0, contract.maximumFiles)) {
        try {
          if (!path.isAbsolute(input)) {
            throw new Error('Invalid file reference')
          }
          const resolved = await realpath(input)
          const info = await stat(resolved)
          const name = path.basename(input)
          const format = contract.formats.find((item) => item.extensions.some((extension) =>
            name.toLowerCase().endsWith(extension)))
          const maximum = format?.maximumBytes ?? contract.maximumBytes
          if (!info.isFile() || !info.size || info.size > maximum) {
            issues.push(`I can’t attach ${name}. Choose a nonempty file within its size limit.`)
            continue
          }
          while (files.size >= contract.maximumFiles * 2) {
            files.delete(files.keys().next().value!)
          }
          const id = randomUUID()
          files.set(id, { path: resolved, name, size: info.size, modified: info.mtimeMs,
            mediaType: format?.mediaType ?? 'text/plain', expires: Date.now() + GRANT_LIFETIME_MS })
          accepted.push({ kind: 'desktop-file', id, name, size: info.size,
            url: `${contract.filesPath}${id}` })
        } catch {
          issues.push('I couldn’t read one of the copied files. Check its availability and try again.')
        }
      }
      if (paths.length > contract.maximumFiles) {
        issues.push(`I can attach up to ${contract.maximumFiles} files per message.`)
      }

      return { files: accepted, issues }
    },
    remove(id: string): void {
      files.delete(id)
    },
    async open(id: string): Promise<OpenFile> {
      prune()
      const file = files.get(id)
      if (!file) {
        throw Object.assign(new Error('This file reference expired. Please paste the file again.'), { status: 410 })
      }
      const handle = await open(file.path, 'r')
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size !== file.size || info.mtimeMs !== file.modified) {
          throw new Error('This file changed. Please paste it again before sending.')
        }
      } catch (error) {
        await handle.close()
        throw error
      }

      return { ...file, handle,
        stream: (options: CreateReadStreamOptions = {}): ReadStream => handle.createReadStream({ highWaterMark: FILE_BUFFER_BYTES, end: file.size - 1, ...options }) }
    }
  }
}
