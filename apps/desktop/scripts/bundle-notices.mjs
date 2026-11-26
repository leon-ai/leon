import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const LICENSE_NAMES = ['LICENSE', 'LICENCE', 'COPYING', 'NOTICE']

/**
 * Preserves notices from dependencies actually included in a bundled host leaf.
 */
export async function writeBundleNotices(metafile, root, destination) {
  const packages = new Map()
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes('node_modules')) {
      continue
    }
    let directory = path.dirname(path.resolve(root, input))
    while (directory !== path.dirname(directory)) {
      const manifest = await readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
      if (manifest?.name && manifest?.version) {
        packages.set(`${manifest.name}@${manifest.version}`, directory)
        break
      }
      directory = path.dirname(directory)
    }
  }
  const notices = []
  for (const [name, directory] of [...packages].sort()) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (file.isFile() && LICENSE_NAMES.some((prefix) => file.name.toUpperCase().startsWith(prefix))) {
        notices.push(`${name} — ${file.name}\n\n${await readFile(path.join(directory, file.name), 'utf8')}`)
      }
    }
  }
  await writeFile(destination, notices.join('\n\n-----\n\n') + '\n')
}
