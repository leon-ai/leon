import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as packageElectron } from 'electron-builder'
import semver from 'semver'

import { bundleCacheKey, bundleOutputDigest, canReuseBundle } from './bundle-cache.mjs'
import { distributionConfig } from './distribution-config.mjs'
import { fileDigest } from './file-digest.mjs'
import { getDownloadRegion, CHINA_BINARY_BASE, isDownloadMirrorAvailable } from '../../../bridges/runtime/nodejs/download-region.js'
import { acquireRuntimeLock, writeRuntimeJSON } from '../../../scripts/distribution/runtime.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url))
const MINIMUM_ICON_COMPILER_VERSION = '26.0.0'
const require = createRequire(import.meta.url)
const diagnostics = process.argv.includes('--diagnostics')
// Publishing remains gated; local macOS builds have only an ad-hoc identity.
const release = false
if (process.argv.slice(2).some((argument) => argument !== '--diagnostics')) {
  throw new Error('Supported option: --diagnostics. Desktop publishing is not enabled.')
}
const manifest = JSON.parse(await readFile(path.join(REPOSITORY, 'package.json'), 'utf8'))
const desktop = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const channel = manifest.version.includes('-') ? 'preview' : 'stable'
const output = path.join(ROOT, 'dist', diagnostics ? 'diagnostics' : 'release')
const artifacts = path.join(ROOT, '.artifacts')
const staging = path.join(artifacts, diagnostics ? 'staging-diagnostics' : 'staging-release')
const buildPath = path.join(artifacts, diagnostics ? 'diagnostics-build.json' : 'build.json')
// A Windows signing certificate can change outside the checkout's build inputs.
const windowsSigning = process.platform === 'win32' && (process.env.WIN_CSC_LINK ?? process.env.CSC_LINK)
const cacheBundle = !diagnostics && !release && process.env.CI !== 'true' && !windowsSigning
const run = (filename, args = []) => execFileSync(process.execPath, [filename, ...args], {
  cwd: REPOSITORY,
  stdio: 'inherit'
})
let iconCompiler = null

if (process.platform === 'darwin') {
  try {
    const compiler = execFileSync('xcrun', ['--find', 'actool'], {
      encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    const output = execFileSync(compiler, ['--version'], { timeout: 5_000 })
    const information = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: output, encoding: 'utf8', timeout: 5_000
    }))
    const version = semver.coerce(information['com.apple.actool.version']?.['short-bundle-version'])
    if (!version || semver.lt(version, MINIMUM_ICON_COMPILER_VERSION)) {
      throw new Error('The selected Xcode cannot compile layered app icons.')
    }
    // The packager invokes actool directly. Honor xcrun/DEVELOPER_DIR selection
    // without requiring the owner to modify their global shell or Xcode choice.
    process.env.PATH = `${path.dirname(compiler)}${path.delimiter}${process.env.PATH ?? ''}`
    iconCompiler = [compiler, information['com.apple.actool.version']]
  } catch (error) {
    const message = 'Layered macOS icons require Xcode 26+. Select it with DEVELOPER_DIR.'
    if (process.env.CI === 'true') {
      throw new Error(message, { cause: error })
    }
    console.warn(`${message} Using the raster icon fallback for this local build.`)
  }
}

await mkdir(artifacts, { recursive: true })
// Generated inputs and the final bundle are shared by builds in this checkout.
const unlock = await acquireRuntimeLock(path.join(artifacts, 'build.lock'))
try {
  process.chdir(REPOSITORY)
  run(require.resolve('tsx/cli'), [path.join(ROOT, 'scripts/build-contracts.ts')])
  await import('./build-runtime.mjs')
  await import('./build-updater.mjs')
  await import('./build-host.mjs')

  const { default: contract } = await import('../.generated/runtime/bootstrap-contract.mjs')
  const config = distributionConfig({ root: ROOT, staging, output,
    manifest: desktop, contract, diagnostics, release, channel })
  // A checkout launcher must not shadow an installed copy in the app menu.
  const desktopName = process.platform === 'linux'
    ? `${config.appId}${release || diagnostics ? '' : '.checkout'}.desktop`
    : undefined
  const electronDirectory = path.dirname(require.resolve('electron/package.json'))
  const electronVersion = desktop.devDependencies.electron
  const archive = `electron-v${electronVersion}-${process.platform}-${process.arch}.zip`
  const environment = { ...process.env }
  const explicitMirror = environment.ELECTRON_MIRROR || environment.npm_config_electron_mirror || environment.NPM_CONFIG_ELECTRON_MIRROR
  let regionalMirror = false
  if (!explicitMirror && !environment.ELECTRON_CUSTOM_DIR && !environment.ELECTRON_CUSTOM_FILENAME &&
      await getDownloadRegion() === 'cn') {
    const mirror = `${CHINA_BINARY_BASE}/electron/`
    if (await isDownloadMirrorAvailable(`${mirror}${electronVersion}/${archive}`)) {
      environment.ELECTRON_MIRROR = mirror
      environment.ELECTRON_CUSTOM_DIR = '{{ version }}'
      regionalMirror = true
    }
  }
  try {
    execFileSync(process.execPath, [path.join(electronDirectory, 'install.js')], {
      env: environment, timeout: 180_000, stdio: 'inherit'
    })
  } catch (error) {
    if (!regionalMirror) {
      throw error
    }
    // Retry the original source once; explicit owner mirrors are never replaced.
    execFileSync(process.execPath, [path.join(electronDirectory, 'install.js')], {
      env: process.env, timeout: 180_000, stdio: 'inherit'
    })
  }

  await rm(staging, { recursive: true, force: true })
  await mkdir(path.join(staging, 'runtime'), { recursive: true })
  await mkdir(path.join(staging, 'src'))
  for (const filename of ['main.js', 'server-runner.js']) {
    await cp(path.join(ROOT, '.generated/src', filename), path.join(staging, 'src', filename))
  }
  if (diagnostics) {
    await mkdir(path.join(staging, 'test'))
    await cp(path.join(ROOT, 'test/bootstrap-fixture.mjs'), path.join(staging, 'test/bootstrap-fixture.mjs'))
  }
  for (const filename of ['desktop-contract.mjs', 'bootstrap-contract.mjs', 'bootstrap-runtime.mjs',
    'bootstrap-notices.txt', 'desktop-updater.mjs', 'updater-notices.txt']) {
    await cp(path.join(ROOT, '.generated/runtime', filename), path.join(staging, 'runtime', filename))
  }
  await cp(path.join(REPOSITORY, 'LICENSE.md'), path.join(staging, 'LICENSE.md'))
  if (process.platform !== 'darwin' || !iconCompiler) {
    const darkIcon = process.platform === 'linux' ? config.icon : path.join(ROOT, 'packaging/icons/dark.png')

    await mkdir(path.join(staging, 'icons'))
    await cp(darkIcon, path.join(staging, 'icons/dark.png'))
    if (process.platform === 'darwin') {
      await cp(path.join(ROOT, 'packaging/icons/light.png'), path.join(staging, 'icons/light.png'))
    }
  }
  await cp(path.join(REPOSITORY, 'apps/web/dist'), path.join(staging, 'web'), { recursive: true })
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({
    name: desktop.name,
    productName: desktop.productName,
    appId: config.appId,
    desktopName,
    dataDirectoryName: desktop.dataDirectoryName,
    version: manifest.version,
    main: 'src/main.js',
    type: 'module',
    author: manifest.author,
    homepage: manifest.homepage,
    license: manifest.license,
    description: desktop.description,
    diagnostics,
    release,
    desktopUpdates: false,
    nativeMacIcon: Boolean(iconCompiler),
    dependencies: {}
  }, null, 2))
  if (process.platform === 'darwin' && !iconCompiler) {
    let fallbackIcon = 'icon.icns'
    try {
      const appearance = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'], {
        encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      if (appearance === 'Dark') {
        fallbackIcon = 'dark.icns'
      }
    } catch {
      // macOS omits AppleInterfaceStyle when the light appearance is selected.
    }
    // Dock restores the bundle icon on exit. Match the local Mac before signing,
    // rather than modifying an installed bundle or relying on a runtime override.
    config.mac.icon = path.join(ROOT, 'packaging/icons', fallbackIcon)
  }
  config.electronDist = path.join(electronDirectory, 'dist')
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
  const executableName = config[platform]?.executableName ?? config.executableName
  const directory = path.join(output, process.platform === 'darwin'
    ? `mac${process.arch === 'arm64' ? '-arm64' : ''}`
    : process.platform === 'win32'
      ? `win${process.arch === 'arm64' ? '-arm64' : ''}-unpacked`
      : `linux${process.arch === 'arm64' ? '-arm64' : ''}-unpacked`)
  const linuxArtwork = path.join(staging, 'icons/dark.png')
  let linuxLauncher
  if (desktopName && !release && !diagnostics) {
    const digest = await fileDigest(linuxArtwork, 'sha256')
    // Give the shell a new icon path when the packaged artwork changes.
    const icon = path.join(directory, 'resources', `leon-icon-${digest}.png`)

    linuxLauncher = { desktopName, name: config.productName, icon }
  }
  const build = { platform: process.platform, arch: process.arch, electron: electronVersion,
    version: manifest.version, output: directory, bundleName: executableName,
    executableName, iconFormat: path.extname(config[platform]?.icon ?? config.icon).slice(1),
    ...(linuxLauncher ? { linuxLauncher } : {}),
    diagnostics, release, channel }
  const cacheKey = cacheBundle
    ? await bundleCacheKey(config, path.join(REPOSITORY, 'pnpm-lock.yaml'), iconCompiler).catch(() => null)
    : null

  if (cacheKey && await canReuseBundle(buildPath, cacheKey, build)) {
    console.log(`Desktop ready: ${directory} (reusing verified bundle)`)
  } else {
    if (cacheBundle) {
      // The packager replaces files in place. Invalidate the receipt first so
      // an interrupted rebuild cannot leave a partial bundle marked reusable.
      await rm(buildPath, { force: true })
    }
    await packageElectron({ projectDir: ROOT, config, publish: 'never' })
    if (iconCompiler) {
      const catalog = path.join(directory, `${executableName}.app`, 'Contents/Resources/Assets.car')
      if (!(await readFile(catalog)).length) {
        throw new Error('The packaged macOS app is missing its compiled icon catalog.')
      }
    }

    if (linuxLauncher) {
      await cp(linuxArtwork, linuxLauncher.icon)
    }

    const outputDigest = cacheKey ? await bundleOutputDigest(build).catch(() => null) : null
    await writeRuntimeJSON(buildPath, { ...build,
      ...(outputDigest ? { bundleCache: { key: cacheKey, outputDigest } } : {}) })
    console.log(`Desktop ready: ${directory}`)
  }
} finally {
  try {
    await rm(staging, { recursive: true, force: true })
  } finally {
    await unlock()
  }
}
