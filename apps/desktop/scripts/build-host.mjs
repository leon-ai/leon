import { build } from 'esbuild'
import { mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../.generated/src/', import.meta.url), { recursive: true })
const files = (await readdir(new URL('../src/', import.meta.url)))
  .filter((name) => name.endsWith('.ts') && name !== 'types.ts')

// Tests execute the same compiled modules that supply the packaged host. Only
// main and the detached runner are copied into ordinary application packages.
await build({
  absWorkingDir: root,
  entryPoints: files.map((name) => `src/${name}`),
  outdir: '.generated/src',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  external: ['electron', '../runtime/*', '../test/bootstrap-fixture.mjs'],
  tsconfig: 'tsconfig.json'
})
