import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { fileDigest } from './file-digest.mjs'

const HASH_ALGORITHM = 'sha256'
const SIGNATURE_CHECK_TIMEOUT_MS = 5_000

/**
 * Hashes a directory's contents, paths and modes independently of file times.
 */
async function directoryDigest(root) {
  const hash = createHash(HASH_ALGORITHM)
  const canonicalRoot = await realpath(root)
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const paths = entries.map((entry) => path.relative(root, path.join(entry.parentPath, entry.name))).sort()

  for (const relative of paths) {
    const filename = path.join(root, relative)
    const entry = await lstat(filename)
    if (entry.isSymbolicLink()) {
      // Links within the tree are covered by the target's own digest.
      if (!(await realpath(filename)).startsWith(`${canonicalRoot}${path.sep}`)) {
        return null
      }
      hash.update(JSON.stringify([relative, entry.mode, await readlink(filename)]))
    } else if (entry.isFile()) {
      hash.update(JSON.stringify([relative, entry.mode, await fileDigest(filename, HASH_ALGORITHM)]))
    } else if (entry.isDirectory()) {
      hash.update(JSON.stringify([relative, entry.mode]))
    } else {
      return null
    }
  }

  return hash.digest('hex')
}

/**
 * Identifies the assembled inputs and the toolchain that packages them.
 */
export async function bundleCacheKey(config, lockfile, iconCompiler) {
  const hash = createHash(HASH_ALGORITHM)

  hash.update(JSON.stringify([config, process.platform, process.arch, process.version, os.release(), iconCompiler,
    await fileDigest(lockfile, HASH_ALGORITHM)]))
  for (const root of [config.directories.app, config.directories.buildResources, config.electronDist]) {
    const digest = await directoryDigest(root)
    if (!digest) {
      return null
    }
    hash.update(digest)
  }

  return hash.digest('hex')
}

/**
 * Records the macOS executable that seals its bundle, or the entire unpacked output.
 */
export function bundleOutputDigest(build) {
  if (build.platform === 'darwin') {
    const executable = path.join(build.output, `${build.bundleName}.app`, 'Contents/MacOS', build.executableName)

    return fileDigest(executable, HASH_ALGORITHM)
  }

  return directoryDigest(build.output)
}

/**
 * Reuses only the output and launcher metadata recorded after successful packaging.
 */
export async function canReuseBundle(buildPath, cacheKey, build) {
  try {
    const { bundleCache, ...previousBuild } = JSON.parse(await readFile(buildPath, 'utf8'))
    if (bundleCache?.key !== cacheKey || !isDeepStrictEqual(previousBuild, build) ||
        !bundleCache.outputDigest || bundleCache.outputDigest !== await bundleOutputDigest(build)) {
      return false
    }

    if (build.platform === 'darwin') {
      const bundle = path.join(build.output, `${build.bundleName}.app`)

      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
        stdio: 'ignore', timeout: SIGNATURE_CHECK_TIMEOUT_MS
      })
    }

    return true
  } catch {
    // A removed, replaced, incomplete or invalid bundle has to be rebuilt.
    return false
  }
}
