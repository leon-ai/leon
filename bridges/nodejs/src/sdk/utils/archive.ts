import fs from 'node:fs/promises'
import path from 'node:path'

import { zipSync } from 'fflate'

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
