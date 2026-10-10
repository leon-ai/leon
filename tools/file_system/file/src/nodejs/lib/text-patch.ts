import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const MAX_DIFF_CHARS = 8_000
const LF = '\n'
const CRLF = '\r\n'

export interface TextChange {
  oldText: string
  newText: string
}

export interface PatchOptions {
  expectedContentHash?: string
}

/**
 * Hash the exact file bytes, including its BOM and line endings.
 */
export function contentHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Validate replacements against one snapshot before atomically replacing a file.
 */
export async function patchTextFile(
  targetPath: string,
  changes: TextChange[],
  options: PatchOptions = {}
): Promise<Record<string, unknown>> {
  const stat = await fs.lstat(targetPath)
  // Renaming over an alias would change the directory entry rather than its target.
  if (!stat.isFile() || stat.nlink > 1) {
    throw new Error('Patch requires a regular file without hard-link aliases.')
  }

  const original = await fs.readFile(targetPath)
  const originalHash = contentHash(original)
  if (options.expectedContentHash && options.expectedContentHash !== originalHash) {
    throw new Error('File content changed. Read the current file before patching.')
  }

  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original)
  if (text.includes('\0') || !changes.length) {
    throw new Error('Patch requires UTF-8 text and at least one replacement.')
  }

  const useCRLF = text.includes(CRLF) && !text.replaceAll(CRLF, '').includes(LF)
  const replacements = changes.map((change, index) => {
    if (!change.oldText) {
      throw new Error(`Replacement ${index + 1} requires non-empty oldText.`)
    }

    const start = text.indexOf(change.oldText)
    if (start < 0 || text.indexOf(change.oldText, start + 1) >= 0) {
      throw new Error(`Replacement ${index + 1} must match exactly once. Read the file and include more context.`)
    }

    return {
      start,
      end: start + change.oldText.length,
      oldText: change.oldText,
      newText: useCRLF
        ? change.newText.replaceAll(CRLF, LF).replaceAll(LF, CRLF)
        : change.newText
    }
  }).sort((first, second) => first.start - second.start)

  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index]!.start < replacements[index - 1]!.end) {
      throw new Error('Replacements overlap. No changes were written.')
    }
  }

  let updated = text
  for (const replacement of replacements.toReversed()) {
    updated = updated.slice(0, replacement.start)
      + replacement.newText
      + updated.slice(replacement.end)
  }

  const bytes = Buffer.from(updated, 'utf8')
  const changed = !original.equals(bytes)
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`)
  if (changed) {
    try {
      const temporary = await fs.open(temporaryPath, 'wx', stat.mode)
      try {
        await temporary.writeFile(bytes)
        await temporary.chmod(stat.mode)
        await temporary.sync()
      } finally {
        await temporary.close()
      }

      // Detect changes during preparation; this is not a lock against external writers.
      const currentStat = await fs.lstat(targetPath)
      if (currentStat.ino !== stat.ino || currentStat.dev !== stat.dev
        || contentHash(await fs.readFile(targetPath)) !== originalHash) {
        throw new Error('File changed while preparing the patch. Read it again.')
      }

      await fs.rename(temporaryPath, targetPath)
    } finally {
      await fs.rm(temporaryPath, { force: true })
    }
  }

  // This is a bounded replacement preview, not an executable unified diff.
  let diff = ''
  for (const replacement of replacements) {
    const line = text.slice(0, replacement.start).split(LF).length
    diff += `@@ original line ${line} @@\n`
      + replacement.oldText.slice(0, MAX_DIFF_CHARS).split(LF).map((value) => `-${value}`).join(LF)
      + LF
      + replacement.newText.slice(0, MAX_DIFF_CHARS).split(LF).map((value) => `+${value}`).join(LF)
      + LF
    if (diff.length > MAX_DIFF_CHARS) {
      break
    }
  }

  return {
    path: targetPath,
    changed,
    replacements: replacements.length,
    contentHash: contentHash(bytes),
    diff: diff.slice(0, MAX_DIFF_CHARS),
    diffTruncated: diff.length > MAX_DIFF_CHARS
  }
}
