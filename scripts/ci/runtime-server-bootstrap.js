import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'
import { ensureModuleMocks } from './module-mocks.js'

const root = process.env.LEON_CODEBASE_PATH
const fixturePath = process.env.LEON_RUNTIME_FIXTURE
// Only release discovery is substituted. Core, HTTP authorization, staging,
// migrations, executable selection and process restart retain their real paths.
if (root && fixturePath && process.argv[1] &&
  fs.realpathSync(process.argv[1]) === path.join(fs.realpathSync(root), 'server/dist/index.js')) {
  await ensureModuleMocks()
  const moduleURL = pathToFileURL(fs.realpathSync(path.join(root, 'server/dist/core/ota/update-service.js')))
  const actual = await import(moduleURL.href)
  const service = new actual.UpdateService({ root, home: process.env.LEON_HOME, managed: true,
    runtimeHome: process.env.LEON_RUNTIME_HOME,
    releases: async () => JSON.parse(fs.readFileSync(fixturePath, 'utf8')).releases,
    runtimeAssets: async () => {
      const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
      return { manifest: fixture.manifest, baseURL: fixture.baseURL }
    } })
  mock.module(moduleURL, { cache: true, exports: { ...actual, UPDATE_SERVICE: service } })
}
