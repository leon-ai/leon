import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { writeBundleNotices } from './bundle-notices.mjs'

const ROOT = process.cwd()
const require = createRequire(import.meta.url)
const result = await build({ entryPoints: [require.resolve('electron-updater')],
  outfile: fileURLToPath(new URL('../.generated/runtime/desktop-updater.mjs', import.meta.url)),
  platform: 'node', format: 'esm', target: 'node24', bundle: true, minify: true,
  external: ['electron'], metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url)' } })
await writeBundleNotices(result.metafile, ROOT, new URL('../.generated/runtime/updater-notices.txt', import.meta.url))
await writeFile(new URL('../.generated/runtime/updater-imports.json', import.meta.url), JSON.stringify(result.metafile, null, 2) + '\n')
