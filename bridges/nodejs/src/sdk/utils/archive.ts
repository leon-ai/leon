import fs from 'node:fs/promises'
import path from 'node:path'

import { unzipSync, zipSync } from 'fflate'

/**
 * Extract ZIP files when a host has no native archive command.
 */
export async function extractZipArchive(archivePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true })
  const destination = await fs.realpath(targetPath)
  const files = unzipSync(await fs.readFile(archivePath))
  const entries = Object.entries(files).map(([name, content]) => {
    const filename = path.resolve(destination, name)
    const relative = path.relative(destination, filename)

    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('ZIP entry escapes its destination.')
    }

    return { filename, content, directory: name.endsWith('/') }
  })

  for (const entry of entries) {
    // Existing destination links must not redirect writes outside the root.
    let ancestor = entry.filename

    while (true) {
      try {
        const relative = path.relative(destination, await fs.realpath(ancestor))

        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error('ZIP entry escapes its destination.')
        }

        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }

        ancestor = path.dirname(ancestor)
      }
    }
  }

  for (const entry of entries) {
    if (entry.directory) {
      await fs.mkdir(entry.filename, { recursive: true })
    } else {
      await fs.mkdir(path.dirname(entry.filename), { recursive: true })
      await fs.writeFile(entry.filename, entry.content)
    }
  }
}

/**
 * Select archive contents using portable paths relative to the source directory.
 */
export interface ZipArchiveOptions {
  exclude?: (relativePath: string) => boolean
}

/**
 * Create a ZIP of regular files without following symlinks or including itself.
 * Excluding a directory also excludes all its descendants.
 */
export async function createZipArchive(
  directory: string,
  destination: string,
  options: ZipArchiveOptions = {}
): Promise<void> {
  const source = path.resolve(directory)
  const output = path.resolve(destination)
  const files: Record<string, Uint8Array> = Object.create(null)

  if (!(await fs.lstat(source)).isDirectory()) {
    throw new Error('ZIP source must be a regular directory.')
  }

  const collect = async (current: string): Promise<void> => {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name)
      const relative = path.relative(source, filename).split(path.sep).join('/')

      if (filename === output || options.exclude?.(relative)) {
        continue
      }

      if (item.isDirectory()) {
        await collect(filename)
      } else if (item.isFile()) {
        files[relative] = await fs.readFile(filename)
      }
    }
  }

  await collect(source)
  await fs.writeFile(output, zipSync(files))
}
