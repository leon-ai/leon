import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import type { DocumentReader } from './document-reader'

const MAX_FILES = 32
const MAX_TEXT_CHARS = 2_000_000
const CACHE_VERSION = 1

interface SearchFile {
  sourcePath: string
  textPath: string
  totalChars: number
  totalPages?: number
  extractedPages?: number
  missingTextPages?: number[]
  nextPage?: number | null
}

/**
 * Materialize extraction once so ordinary ripgrep searches can reuse it.
 * Files are retained with the conversation's other artifacts, never globally.
 */
export async function prepareDocumentSearch(
  reader: DocumentReader,
  sources: string[],
  directory: string,
  ocr = false
): Promise<Record<string, unknown>> {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_FILES) {
    throw new Error(`Select between 1 and ${MAX_FILES} document paths.`)
  }

  await fs.mkdir(directory, { recursive: true, mode: 0o700 })

  const documents: SearchFile[] = []
  const failures: { sourcePath: string, error: string }[] = []
  let cachedDocuments = 0

  for (const sourcePath of [...new Set(sources)]) {
    try {
      const stat = await fs.stat(sourcePath)
      const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
      const key = createHash('sha256')
        .update(JSON.stringify([CACHE_VERSION, sourcePath, signature, ocr]))
        .digest('hex')
      const textPath = path.join(directory, `${key}.md`)
      const manifestPath = path.join(directory, `${key}.json`)
      let document: SearchFile | undefined

      try {
        const retained = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as SearchFile
        await fs.access(textPath)
        document = retained
        cachedDocuments += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      if (!document) {
        const { text, ...coverage } = await reader.extractSearchText(sourcePath, ocr)

        if (text.length > MAX_TEXT_CHARS) {
          throw new Error(`Extracted text exceeds the ${MAX_TEXT_CHARS} character search budget; read selected pages instead.`)
        }

        // A changed input must not be published under its previous cache identity.
        const current = await fs.stat(sourcePath)
        const currentSignature = `${current.dev}:${current.ino}:${current.size}:${current.mtimeMs}:${current.ctimeMs}`

        if (currentSignature !== signature) {
          throw new Error('Document changed during extraction. Repeat preparation.')
        }

        const temporaryPath = path.join(directory, `${randomUUID()}.tmp`)

        try {
          await fs.writeFile(temporaryPath, text, { flag: 'wx', mode: 0o600 })
          await fs.rename(temporaryPath, textPath)
        } finally {
          await fs.rm(temporaryPath, { force: true })
        }

        document = { sourcePath, textPath, totalChars: text.length, ...coverage }
        await fs.writeFile(manifestPath, JSON.stringify(document), { mode: 0o600 })
      }

      documents.push(document)
    } catch (error) {
      failures.push({
        sourcePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    paths: documents.map((document) => document.textPath),
    documents,
    failures,
    cachedDocuments,
    complete: failures.length === 0 && documents.every((document) =>
      !document.nextPage && !document.missingTextPages?.length
    ),
    coverage: 'Extracted text only. Search these paths with ripgrep; map results to sourcePath. PDF page markers identify page boundaries; embedded visuals are not interpreted.'
  }
}
