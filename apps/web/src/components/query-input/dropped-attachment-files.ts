export const MAXIMUM_ATTACHMENT_ENTRIES = 2_000

/**
 * Captures entries while the browser's drop data store is still readable.
 */
export function getDroppedAttachmentEntries(transfer: DataTransfer): FileSystemEntry[] {
  return Array.from(transfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))
}

/**
 * Walks folder drops incrementally without extracting archives or retaining a
 * whole tree. Readers must be drained: Chromium returns directory pages of 100.
 */
export async function* readDroppedAttachmentFiles(
  entries: FileSystemEntry[], signal: AbortSignal, onIssue: (message: string) => void
): AsyncGenerator<File> {
  const pending: (FileSystemEntry | FileSystemDirectoryReader)[] = entries.slice(0, MAXIMUM_ATTACHMENT_ENTRIES).reverse()
  const limitIssue = `I limited this folder to ${MAXIMUM_ATTACHMENT_ENTRIES.toLocaleString()} entries. Please choose a smaller folder.`
  let scheduled = pending.length

  if (entries.length > MAXIMUM_ATTACHMENT_ENTRIES) {
    onIssue(limitIssue)
  }

  while (pending.length && !signal.aborted) {
    const entry = pending.pop()!
    try {
      if ('readEntries' in entry) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => entry.readEntries(resolve, reject))
        if (signal.aborted) {
          return
        }
        if (children.length) {
          // Bound queued entries too: some browsers return an entire directory
          // in one page, including trees with many wide, nested branches.
          const available = MAXIMUM_ATTACHMENT_ENTRIES - scheduled
          const accepted = children.slice(0, available)
          scheduled += accepted.length
          if (accepted.length < children.length) {
            onIssue(limitIssue)
          }
          if (scheduled < MAXIMUM_ATTACHMENT_ENTRIES) {
            pending.push(entry)
          }
          pending.push(...accepted.reverse())
        }
        continue
      }
      if (entry.isDirectory) {
        pending.push((entry as FileSystemDirectoryEntry).createReader())
      } else if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
        if (!signal.aborted) {
          yield file
        }
      }
    } catch {
      if (!signal.aborted) {
        onIssue('I could not read some files in this folder. Please check their permissions and try again.')
      }
    }
  }
}
