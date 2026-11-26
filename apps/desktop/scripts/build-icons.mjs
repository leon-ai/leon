import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { CHINA_BINARY_BASE, getDownloadRegion, isDownloadMirrorAvailable } from '../../../bridges/runtime/nodejs/download-region.js'

const OUTPUT = new URL('../packaging/icons/', import.meta.url)
const COMPOSER = new URL('../packaging/Leon.icon/', import.meta.url)
const SIZE = 1_024
const INSET_TILE_SIZE = 896
const LOGO_FRACTION = 0.8
const RIM_WIDTH = 6
const BEVEL_WIDTH = 30
const FALLBACK_LIGHTING = {
  light: {
    rim: 'conic-gradient(from 315deg, #00000040, #00000006 25%, #00000058 50%, #00000006 75%, #00000040)',
    bevel: `inset 18px 18px ${BEVEL_WIDTH}px -22px #ffffff, inset -18px -18px ${BEVEL_WIDTH}px -22px #00000045`
  },
  dark: {
    rim: 'conic-gradient(from 315deg, #fffffff0, #ffffff08 25%, #fffffff0 50%, #ffffff08 75%, #fffffff0)',
    bevel: `inset 18px 18px ${BEVEL_WIDTH}px -22px #ffffffbf, inset -18px -18px ${BEVEL_WIDTH}px -22px #ffffffbf`
  }
}
const composer = JSON.parse(await readFile(new URL('icon.json', COMPOSER), 'utf8'))
const RASTER_ICONS = [
  { name: 'light', theme: 'light', size: INSET_TILE_SIZE },
  { name: 'dark', theme: 'dark', size: INSET_TILE_SIZE },
  // Linux desktop shells pad the surrounding button separately.
  { name: 'linux', theme: 'dark', size: SIZE }
]
// Matches the checksum-pinned toolset in the installed electron-builder.
const ICON_TOOL_RELEASE = 'icons@1.2.3'
const MIRROR_VARIABLES = ['NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR',
  'npm_config_electron_builder_binaries_mirror', 'npm_package_config_electron_builder_binaries_mirror',
  'ELECTRON_BUILDER_BINARIES_MIRROR']
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { runIconsTool } = builderRequire('app-builder-lib/out/toolsets/icons.js')
const logo = await readFile(new URL('../../web/public/img/logo-color.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true })

// Native artwork has no mask, background, or baked effects: macOS supplies them.
// Raster fallbacks approximate the native edge lighting in static pixels. Keep
// those effects out of the layered source to avoid double lighting in macOS.
try {
  await mkdir(OUTPUT, { recursive: true })
  await mkdir(new URL('Assets/', COMPOSER), { recursive: true })
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
  const artwork = await page.evaluate(({ source, size, fraction }) => {
    const image = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
    const box = image.viewBox.baseVal
    const width = size * fraction
    const height = width * box.height / box.width
    const canvas = document.createElementNS(image.namespaceURI, 'svg')
    canvas.setAttribute('width', String(size))
    canvas.setAttribute('height', String(size))
    canvas.setAttribute('viewBox', `0 0 ${size} ${size}`)
    image.setAttribute('x', String((size - width) / 2))
    image.setAttribute('y', String((size - height) / 2))
    image.setAttribute('width', String(width))
    image.setAttribute('height', String(height))
    canvas.append(image)

    return new XMLSerializer().serializeToString(canvas)
  }, { source: logo, size: SIZE, fraction: LOGO_FRACTION })
  await writeFile(new URL('Assets/logo.svg', COMPOSER), artwork + '\n')
  for (const { name, theme, size } of RASTER_ICONS) {
    // Use the Icon Composer document as the single owner of appearance colors.
    const appearance = theme === 'dark' ? theme : undefined
    const { value: fill } = composer['fill-specializations'].find((item) => item.appearance === appearance)
    const [space, value] = fill.solid.split(':')
    const channels = value.split(',')
    const alpha = channels.pop()
    const background = `color(${space} ${channels.join(' ')} / ${alpha})`
    const lighting = FALLBACK_LIGHTING[theme]
    await page.setContent(`<html><head><style>
      html,body{margin:0;background:transparent}body{width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center}
      .tile{position:relative;width:${size}px;height:${size}px;border-radius:${size / 4}px;
        background:${background};display:grid;place-items:center;isolation:isolate}
      .tile::before,.tile::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none}
      .tile::before{box-shadow:${lighting.bevel}}
      .tile::after{padding:${RIM_WIDTH}px;background:${lighting.rim};
        mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude}
      svg{position:relative;width:${size * LOGO_FRACTION}px;height:auto}
      </style></head><body><div class="tile">${logo}</div></body></html>`)
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUTPUT)), omitBackground: true })
  }
} finally {
  await browser.close()
}

const mirror = `${CHINA_BINARY_BASE}/electron-builder-binaries/`
const regionalMirror = !MIRROR_VARIABLES.some((key) => process.env[key]) &&
  await getDownloadRegion() === 'cn' &&
  await isDownloadMirrorAvailable(`${mirror}${ICON_TOOL_RELEASE}/icons-bundle.tar.gz`)
if (regionalMirror) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = mirror
}
try {
  for (const [appearance, format] of [['dark', 'icns'], ['light', 'icns'], ['dark', 'ico']]) {
    const convert = () => runIconsTool({ inputFile: fileURLToPath(new URL(`${appearance}.png`, OUTPUT)),
      outputFormat: format, outDir: fileURLToPath(OUTPUT) })
    try {
      await convert()
    } catch (error) {
      if (!regionalMirror) {
        throw error
      }
      // Keep the converter's embedded checksums and retry the original once.
      delete process.env.ELECTRON_BUILDER_BINARIES_MIRROR
      await convert()
    }
    if (appearance === 'dark' && format === 'icns') {
      // Keep both fallback appearances; the packager selects one before signing.
      await rename(new URL('icon.icns', OUTPUT), new URL('dark.icns', OUTPUT))
    }
  }
} finally {
  if (regionalMirror) {
    delete process.env.ELECTRON_BUILDER_BINARIES_MIRROR
  }
}
console.log(`Desktop icons ready: ${path.relative(process.cwd(), fileURLToPath(OUTPUT))}`)
