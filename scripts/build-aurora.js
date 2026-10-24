import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { execa } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

const AURORA_DIST_PATH = path.join(process.cwd(), 'aurora', 'dist')
const AURORA_TSCONFIG_PATH = path.join('aurora', 'tsconfig.build.json')
const TSC_BIN_NAME = SystemHelper.isWindows() ? 'tsc.cmd' : 'tsc'
const TSC_BIN_PATH = path.join(process.cwd(), 'node_modules', '.bin', TSC_BIN_NAME)
const TSC_FALLBACK_BIN_PATH = path.join(process.cwd(), 'node_modules', '.bin', 'tsc')

/**
 * Build Aurora declaration files from local source.
 */
export default async function buildAurora(options = {}) {
  const { quiet = false } = options

  await fs.promises.rm(AURORA_DIST_PATH, {
    recursive: true,
    force: true
  })

  try {
    await execa(TSC_BIN_PATH, ['--project', AURORA_TSCONFIG_PATH], {
      stdio: quiet ? 'ignore' : 'inherit'
    })
  } catch (error) {
    if (!SystemHelper.isWindows() || TSC_BIN_PATH === TSC_FALLBACK_BIN_PATH) {
      throw error
    }

    await execa(TSC_FALLBACK_BIN_PATH, ['--project', AURORA_TSCONFIG_PATH], {
      stdio: quiet ? 'ignore' : 'inherit'
    })
  }

  if (!quiet) {
    LogHelper.success('Aurora: ready')
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  ;(async () => {
    try {
      await buildAurora()
    } catch (e) {
      LogHelper.error(`Failed to build Aurora: ${e}`)
      process.exit(1)
    }
  })()
}
