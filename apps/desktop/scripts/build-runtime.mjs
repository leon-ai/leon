import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeBundleNotices } from './bundle-notices.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const OUTPUT = fileURLToPath(new URL('../.generated/runtime/', import.meta.url))

// Bundle canonical leaves directly; Core services and bridge SDKs stay outside
// the desktop host, including when no repository dependencies are installed.
const result = await build({
  absWorkingDir: ROOT,
  stdin: {
    contents: `
export * from './scripts/distribution/runtime.js'
export { getUpdateStatePath } from './scripts/update/paths.js'
export { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_JITTER_MS, UPDATE_STAGE_LABELS } from './bridges/runtime/contracts/update-status.js'
export { FileDownloader } from './bridges/runtime/nodejs/file-downloader.ts'
export { LEON_HOME_PATH, LEON_PROFILE_NAME, isValidProfileName } from './server/src/leon-roots.ts'
export { getProfilePaths } from './server/src/core/profile-runtime/profile-paths.ts'
export { JsonRedactionHelper } from './server/src/helpers/json-redaction-helper.ts'
export { default as YAML } from 'yaml'
export { default as dotenv } from 'dotenv'
export { default as semver } from 'semver'
`,
    resolveDir: ROOT,
    loader: 'ts'
  },
  outfile: path.join(OUTPUT, 'bootstrap-runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  metafile: true,
  alias: {
    '@/leon-roots': path.join(ROOT, 'server/src/leon-roots.ts'),
    '@/core/profile-runtime/profile-context': path.join(ROOT, 'server/src/core/profile-runtime/profile-context.ts')
  },
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url)'
  }
})

await writeFile(path.join(OUTPUT, 'bootstrap-imports.json'),
  JSON.stringify(result.metafile, null, 2) + '\n')
await writeBundleNotices(result.metafile, ROOT, path.join(OUTPUT, 'bootstrap-notices.txt'))
