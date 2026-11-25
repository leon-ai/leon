import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

import { CHINA_BINARY_BASE, getDownloadRegion, isDownloadMirrorAvailable } from '../../../bridges/runtime/nodejs/download-region.js'

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const args = [cli, 'install', 'chromium']
const PLAYWRIGHT_CDN = 'https://cdn.playwright.dev'
const PLAYWRIGHT_LEGACY_PREFIX = '/dbazure/download/playwright'
const MIRROR_PROVISION_TIMEOUT_MS = 240_000

/**
 * Uses the installed CLI to list this platform's exact pinned artifacts.
 */
async function availableMirror() {
  const mirror = `${CHINA_BINARY_BASE}/playwright`
  const plan = spawnSync(process.execPath, [...args, '--dry-run'], { encoding: 'utf8', timeout: 10_000 })
  const sources = plan.stdout?.matchAll(/^\s*Download url:\s*(\S+)/gm)
  const paths = Array.from(sources ?? [], ([, source]) => {
    const url = new URL(source)

    return url.origin === PLAYWRIGHT_CDN
      ? url.pathname.replace(PLAYWRIGHT_LEGACY_PREFIX, '') : ''
  })
  if (plan.status !== 0 || !paths.length || paths.some((path) => !path.startsWith('/builds/'))) {
    return undefined
  }
  const available = await Promise.all(paths.map((path) => isDownloadMirrorAvailable(mirror + path)))

  return available.every(Boolean) ? mirror : undefined
}

const environment = process.env
const explicitHost = environment.PLAYWRIGHT_DOWNLOAD_HOST ||
  environment.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST || environment.PLAYWRIGHT_FFMPEG_DOWNLOAD_HOST
const mirror = !explicitHost && await getDownloadRegion() === 'cn' ? await availableMirror() : undefined
const mirrored = mirror && spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: { ...environment, PLAYWRIGHT_DOWNLOAD_HOST: mirror },
  timeout: MIRROR_PROVISION_TIMEOUT_MS
})
if (mirrored?.status !== 0) {
  const direct = spawnSync(process.execPath, args, { stdio: 'inherit', env: environment })
  process.exitCode = direct.status ?? 1
}
