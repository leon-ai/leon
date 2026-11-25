import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'
import { ensureModuleMocks } from './module-mocks.js'

const root = process.env.LEON_CODEBASE_PATH
const fixturePath = process.env.LEON_OTA_FIXTURE

// Replace only the external release source in the real server process. Installer
// children inherit NODE_OPTIONS too, but must not import or mock the running server.
if (root && fixturePath && process.argv[1]
  && fs.realpathSync(process.argv[1]) === path.join(fs.realpathSync(root), 'server', 'dist', 'index.js')) {
  await ensureModuleMocks()
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const serviceURL = pathToFileURL(fs.realpathSync(path.join(root, 'server', 'dist', 'core', 'updates', 'update-service.js')))
  const actual = await import(serviceURL.href)
  const service = new actual.UpdateService({ root, home: process.env.LEON_HOME, managed: true,
    repository: fixture.repository,
    releases: async () => JSON.parse(fs.readFileSync(fixturePath, 'utf8')).releases })
  mock.module(serviceURL, { cache: true, exports: { ...actual, UPDATE_SERVICE: service } })
  fs.appendFileSync(fixture.boots, `${JSON.stringify({ pid: process.pid, version: process.env.npm_package_version })}\n`)
}
