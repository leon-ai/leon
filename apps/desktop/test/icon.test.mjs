import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ICON_PATH = fileURLToPath(new URL('../packaging/Leon.icon', import.meta.url))

test('compiles the authored app icon into native macOS assets', {
  skip: process.platform !== 'darwin' || process.env.CI !== 'true'
    ? 'Native icon compilation runs on macOS CI with Xcode installed'
    : false
}, async () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const compilerPath = builderRequire.resolve('app-builder-lib/out/util/macosIconComposer.js')
  const compilerRequire = createRequire(compilerPath)
  const actool = execFileSync('xcrun', ['--find', 'actool'], { encoding: 'utf8' }).trim()

  // The packager invokes actool by name; retain compiler warnings if no assets are produced.
  process.env.PATH = `${path.dirname(actool)}${path.delimiter}${process.env.PATH ?? ''}`
  compilerRequire('builder-util').debug.enabled = true

  const { assetCatalog, icnsFile } = await compilerRequire(compilerPath).generateAssetCatalogForIcon(ICON_PATH)

  assert(assetCatalog.byteLength > 0, 'The layered icon needs a compiled asset catalog')
  assert(icnsFile.byteLength > 8, 'Older macOS versions need a fallback icon')
  assert.equal(icnsFile.toString('ascii', 0, 4), 'icns')
})
