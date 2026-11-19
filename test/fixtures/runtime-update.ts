import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { create } from 'tar'
import { copyRuntimeDependencies, runtimeDependencyLinks } from '../../scripts/distribution/dependencies.js'

import { RUNTIME_MANIFEST, runtimePlatform } from '../../scripts/distribution/runtime.js'

/**
 * Builds an isolated release with observable readiness and failure behavior.
 * Fixtures use the test runner's Node; production archives include native Node.
 */
export async function createRuntimeArchive(directory: string, version: string, { broken = false, escape = false } = {}): Promise<{
  archive: string
  asset: { name: string, version: string, platform: string, bytes: number, sha256: string, url: string }
}> {
  const root = path.join(directory, `source-${version}`)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ type: 'module', version }),
    [process.platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node']: `#!/bin/sh\nexec '${process.execPath.replaceAll('\'', '\'\\\'\'')}' "$@"\n`,
    [process.platform === 'win32' ? 'runtime/pnpm/pnpm.exe' : 'runtime/pnpm/pnpm']: '#!/bin/sh\nexit 91\n',
    'server/dist/pre-check.js': '',
    'server/dist/distribution-setup.js': 'if (process.stdin.isTTY) process.exit(92)',
    'apps/web/dist/index.html': `<main>${version}</main>`,
    'server/dist/index.js': broken ? 'throw new Error("Cannot boot candidate")' : `import http from 'node:http'
const version = ${JSON.stringify(version)}
process.send?.({ kind: 'leon:core-ready', version })
http.createServer((request,response) => {
  if(request.url === '/update') { response.end('updating'); process.exit(78) }
  response.end(version)
}).listen(Number(process.env.FIXTURE_PORT), '127.0.0.1')`,
    [RUNTIME_MANIFEST]: JSON.stringify({ schemaVersion: 1, version, platform: runtimePlatform(), links: [] })
  }
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content, { mode: 0o755 })
  }
  for (const file of ['scripts/distribution/runtime.js', 'scripts/run-runtime.js', 'scripts/update/paths.js',
    'scripts/update/run-runtime-update.js', 'scripts/update/progress.js', 'bridges/runtime/contracts/update-status.js', 'bridges/runtime/contracts/distribution.js',
    'server/dist/bridges/runtime/nodejs/file-downloader.js']) {
    const target = path.join(root, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.resolve(file), target)
  }
  const dependencies = path.join(directory, 'dependency-source')
  await fs.mkdir(dependencies, { recursive: true })
  await fs.writeFile(path.join(dependencies, 'package.json'), JSON.stringify({ dependencies: { tar: '*', semver: '*' } }))
  await fs.symlink(path.resolve('node_modules'), path.join(dependencies, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
  })
  await copyRuntimeDependencies(dependencies, path.join(root, 'node_modules'))
  const links = await runtimeDependencyLinks(root)
  if (escape) {
    links.push({ path: '../../../../profiles/owner/private', target: 'package.json', directory: false })
  }
  await fs.writeFile(path.join(root, RUNTIME_MANIFEST), JSON.stringify({ schemaVersion: 1, version,
    platform: runtimePlatform(), links }))
  const name = `leon-core-${version}-${runtimePlatform()}.tar.gz`
  const archive = path.join(directory, name)
  await create({ file: archive, cwd: root, gzip: true, portable: true, filter: (_name, info) => !info.isSymbolicLink() }, await fs.readdir(root))
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) {
    hash.update(chunk)
  }
  return { archive, asset: { name, version, platform: runtimePlatform(), bytes: (await fs.stat(archive)).size,
    sha256: hash.digest('hex'), url: '' } }
}

/**
 * Gives each runtime scenario a private home and installation store.
 */
export async function runtimeFixtureHome(): Promise<{ home: string, installation: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-runtime-update-'))
  return { home, installation: path.join(home, 'runtimes/core') }
}
