import fs from 'node:fs'
import path from 'node:path'
import stream from 'node:stream'
import readline from 'node:readline'

import axios from 'axios'
import prettyBytes from 'pretty-bytes'
import prettyMilliseconds from 'pretty-ms'
import extractZip from 'extract-zip'

import {
  BINARIES_FOLDER_NAME,
  GITHUB_URL,
  NODEJS_BRIDGE_DIST_PATH,
  PYTHON_BRIDGE_DIST_PATH,
  TCP_SERVER_DIST_PATH,
  NODEJS_BRIDGE_BIN_NAME,
  PYTHON_BRIDGE_BIN_NAME,
  TCP_SERVER_BIN_NAME,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_VERSION,
  TCP_SERVER_VERSION
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

/**
 * Set up binaries according to the given setup target
 * 1. Delete the existing dist binaries if already exist
 * 2. Download the latest binaries from GitHub releases
 * 3. Extract the downloaded ZIP file to the dist folder
 */

const TARGETS = new Map()

TARGETS.set('nodejs-bridge', {
  name: 'Node.js bridge',
  distPath: NODEJS_BRIDGE_DIST_PATH,
  manifestPath: path.join(NODEJS_BRIDGE_DIST_PATH, 'manifest.json'),
  archiveName: `${NODEJS_BRIDGE_BIN_NAME.split('.')[0]}.zip`,
  version: NODEJS_BRIDGE_VERSION,
  isPlatformDependent: false // Need to be built for the target platform or not
})
TARGETS.set('python-bridge', {
  name: 'Python bridge',
  distPath: PYTHON_BRIDGE_DIST_PATH,
  manifestPath: path.join(PYTHON_BRIDGE_DIST_PATH, 'manifest.json'),
  archiveName: `${PYTHON_BRIDGE_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  version: PYTHON_BRIDGE_VERSION,
  isPlatformDependent: true
})
TARGETS.set('tcp-server', {
  name: 'TCP server',
  distPath: TCP_SERVER_DIST_PATH,
  manifestPath: path.join(TCP_SERVER_DIST_PATH, 'manifest.json'),
  archiveName: `${TCP_SERVER_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  version: TCP_SERVER_VERSION,
  isPlatformDependent: true
})

async function createManifestFile(manifestPath, name, version) {
  const manifest = {
    name,
    version,
    setupDate: Date.now()
  }

  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}

const setupBinaries = async (key) => {
  const {
    name,
    distPath,
    archiveName,
    version,
    manifestPath,
    isPlatformDependent
  } = TARGETS.get(key)
  let manifest = null

  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))

    LogHelper.info(`Found ${name} ${manifest.version}`)
    LogHelper.info(`Latest version is ${version}`)
  }

  if (!manifest || manifest.version !== version) {
    const buildPath = isPlatformDependent
      ? path.join(distPath, BINARIES_FOLDER_NAME)
      : distPath
    const archivePath = path.join(distPath, archiveName)

    await Promise.all([
      fs.promises.rm(buildPath, { recursive: true, force: true }),
      fs.promises.rm(archivePath, { recursive: true, force: true })
    ])

    try {
      LogHelper.info(`Downloading ${name}...`)

      const archiveWriter = fs.createWriteStream(archivePath)
      const latestReleaseAssetURL = `${GITHUB_URL}/releases/download/${key}_v${version}/${archiveName}`
      const { data } = await axios.get(latestReleaseAssetURL, {
        responseType: 'stream',
        onDownloadProgress: ({ loaded, total, progress, estimated, rate }) => {
          const percentage = Math.floor(progress * 100)
          const downloadedSize = prettyBytes(loaded)
          const totalSize = prettyBytes(total)
          const estimatedTime = !estimated
            ? 0
            : prettyMilliseconds(estimated * 1_000, { secondsDecimalDigits: 0 })
          const downloadRate = !rate ? 0 : prettyBytes(rate)

          readline.clearLine(process.stdout, 0)
          readline.cursorTo(process.stdout, 0, null)
          process.stdout.write(
            `Download progress: ${percentage}% (${downloadedSize}/${totalSize} | ${downloadRate}/s | ${estimatedTime} ETA)`
          )

          if (percentage === 100) {
            process.stdout.write('\n')
          }
        }
      })

      data.pipe(archiveWriter)
      await stream.promises.finished(archiveWriter)

      LogHelper.success(`${name} downloaded`)
      LogHelper.info(`Extracting ${name}...`)

      const absoluteDistPath = path.resolve(distPath)
      await extractZip(archivePath, { dir: absoluteDistPath })

      LogHelper.success(`${name} extracted`)

      await Promise.all([
        fs.promises.rm(archivePath, { recursive: true, force: true }),
        createManifestFile(manifestPath, name, version)
      ])

      LogHelper.success(`${name} manifest file created`)
      LogHelper.success(`${name} ${version} ready`)
    } catch (error) {
      throw new Error(`Failed to set up ${name}: ${error}`)
    }
  } else {
    LogHelper.success(`${name} is already at the latest version (${version})`)
  }
}

export default async () => {
  // await setupBinaries('nodejs-bridge')
  await setupBinaries('python-bridge')
  await setupBinaries('tcp-server')
}
