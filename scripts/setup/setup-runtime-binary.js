import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

import { FileHelper } from '@/helpers/file-helper'
import { SystemHelper } from '@/helpers/system-helper'

import { createSetupStatus } from './setup-status'

const LOCKED_PATH_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

async function getFlattenedExtractionRoot(extractionPath) {
  const entries = await fs.promises.readdir(extractionPath, {
    withFileTypes: true
  })

  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractionPath, entries[0].name)
  }

  return extractionPath
}

/**
 * Install a portable runtime into Leon's managed `bin/` directory from either
 * an archive asset or a direct executable download.
 */
export async function setupRuntimeBinary({
  name,
  version,
  basePath,
  installPath,
  manifestPath,
  binaryPath,
  downloadURL,
  archiveFileName = null
}) {
  const status = createSetupStatus(`Downloading and setting up ${name}...`).start()
  const manifest = readManifest(manifestPath)

  if (manifest?.version === version && fs.existsSync(binaryPath)) {
    status.succeed(`${name}: ${version}`)

    return
  }

  const relative = (filename) => {
    const value = path.relative(basePath, filename)
    assert(!value.startsWith('..') && !path.isAbsolute(value), 'Runtime files must stay within their installation')

    return value
  }
  let staging
  let preserveBackup = false

  try {
    await fs.promises.mkdir(path.dirname(basePath), { recursive: true })
    // Keep downloads and extraction beside the live runtime. A failed download
    // must leave the executable available to both Core and its recovery worker.
    staging = await fs.promises.mkdtemp(path.join(path.dirname(basePath), `.${path.basename(basePath)}-`))
    const candidate = path.join(staging, 'candidate')
    const backup = path.join(staging, 'previous')
    const stagedBinary = path.join(candidate, relative(binaryPath))
    await fs.promises.mkdir(candidate)
    status.pause()

    if (archiveFileName) {
      const archivePath = path.join(staging, archiveFileName)
      const extractionPath = path.join(staging, 'extracted')
      await fs.promises.mkdir(extractionPath)

      try {
        await FileHelper.downloadFile(downloadURL, archivePath, {
          cliProgress: true,
          parallelStreams: 3,
          skipExisting: false
        })
        status.text = `Installing ${name}...`
        status.start()

        await FileHelper.extractArchive(archivePath, extractionPath)

        const flattenedRootPath = await getFlattenedExtractionRoot(extractionPath)

        await fs.promises.cp(flattenedRootPath, path.join(candidate, relative(installPath)), {
          recursive: true, verbatimSymlinks: true
        })
      } finally {
        await Promise.all([
          fs.promises.rm(archivePath, { force: true }),
          fs.promises.rm(extractionPath, { recursive: true, force: true })
        ])
      }
    } else {
      await fs.promises.mkdir(path.dirname(stagedBinary), { recursive: true })

      await FileHelper.downloadFile(downloadURL, stagedBinary, {
        cliProgress: true,
        parallelStreams: 3,
        skipExisting: false
      })
      status.text = `Finalizing ${name}...`
      status.start()
    }

    if (!SystemHelper.isWindows()) {
      await fs.promises.chmod(stagedBinary, 0o755)
    }

    if (!(await fs.promises.stat(stagedBinary)).isFile()) {
      throw new Error(`Cannot find the staged ${name} binary`)
    }

    const versions = path.join(basePath, 'versions.json')
    if (fs.existsSync(versions)) {
      await fs.promises.copyFile(versions, path.join(candidate, 'versions.json'))
    }
    await FileHelper.createManifestFile(path.join(candidate, relative(manifestPath)), name.toLowerCase(), version, {
      os: SystemHelper.getInformation().type,
      architecture: SystemHelper.getInformation().cpuArchitecture
    })

    const previous = fs.existsSync(basePath)
    if (previous) {
      await fs.promises.rename(basePath, backup)
      preserveBackup = true
    }
    try {
      await fs.promises.rename(candidate, basePath)
      preserveBackup = false
    } catch (error) {
      if (previous) {
        await fs.promises.rename(backup, basePath)
        preserveBackup = false
      }
      throw error
    }

    status.succeed(`${name}: ${version}`)
  } catch (error) {
    status.fail(`Failed to set up ${name}`)

    throw new Error(`Failed to set up ${name}: ${error}`)
  } finally {
    if (staging && !preserveBackup) {
      // Windows can retain a running executable in the old directory until its
      // installer exits. A locked backup must not turn a valid install into failure.
      await fs.promises.rm(staging, { recursive: true, force: true }).catch((error) => {
        if (!LOCKED_PATH_ERROR_CODES.has(error.code)) {
          throw error
        }
      })
    }
  }
}
