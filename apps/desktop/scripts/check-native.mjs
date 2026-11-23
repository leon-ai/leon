import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, open, writeFile, readFile, cp, chmod, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { create } from 'tar'

import { launchDiagnostic, ROOT } from './native.mjs'
import { createFixture } from '../test/fixture.mjs'
import { controlCore } from '../.generated/src/service.js'
import { LEON_HOME_PATH, getProfilePaths } from '../.generated/runtime/bootstrap-runtime.mjs'
import contract from '../.generated/runtime/bootstrap-contract.mjs'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/distribution.js'

const { values } = parseArgs({ options: { only: { type: 'string' } } })
assert(!values.only || ['transport', 'bootstrap', 'lifecycle'].includes(values.only), 'Use --only transport, --only bootstrap or --only lifecycle')

async function lifecycle() {
  const fixture = await createFixture()
  let app
  try {
    const quitPaths = process.platform === 'darwin' ? ['application', 'native'] : ['application']
    for (const quitPath of quitPaths) {
      const nativeQuit = quitPath === 'native'
      app = await launchDiagnostic({ name: `lifecycle-${quitPath}`, script: 'lifecycle.js', server: fixture.origin,
        configuration: { paint_when_hidden: true, native_quit: nativeQuit } })
      const result = await app.wait('complete')
      if (nativeQuit) {
        await app.quit()
      }
      await app.waitForExit()
      console.log(`Desktop lifecycle: ${result.checks.length} window checks passed; ${quitPath} quit exits`)
      await app.close()
      app = undefined
    }
  } finally {
    await app?.close()
    await fixture.close()
  }
}

async function transport() {
  const fixture = await createFixture({ requireLogin: true, visual: true })
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'leon-native-files-'))
  let app
  try {
    const filename = 'Quiet afternoon · 你好.txt'
    const file = path.join(temporary, filename)
    const handle = await open(file, 'w')
    const chunk = Buffer.from('A quiet afternoon.\n'.repeat(4_096))
    const hash = createHash('sha256')
    try {
      for (let index = 0; index < 512; index += 1) {
        await handle.write(chunk)
        hash.update(chunk)
      }
    } finally {
      await handle.close()
    }
    const expected = hash.digest('hex')
    app = await launchDiagnostic({ name: 'desktop-parity', script: 'desktop-parity.js', server: fixture.origin,
      configuration: { clipboard_files: [file], filename } })
    const result = await app.wait()
    const bytes = (await stat(file)).size
    assert(fixture.uploads.some((upload) => upload.complete && upload.bytes === bytes && upload.digest === expected),
      'Native file bytes must arrive unchanged at Core')
    assert(fixture.uploads.some((upload) => !upload.complete && upload.bytes < bytes),
      'Cancelling a native upload must stop delivery')
    await writeFile(app.report, JSON.stringify({ ...result, transport: { native_bytes: bytes, sha256_verified: true } }, null, 2) + '\n')
    console.log(`Desktop transport: ${result.checks.length} checks passed; ${bytes} native bytes verified`)
  } finally {
    await app?.close()
    await fixture.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

async function bootstrap() {
  const fixture = await createFixture()
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'leon-native-core-'))
  const home = path.join(temporary, 'home')
  let app
  let archiveServer
  try {
    const payload = path.join(temporary, 'payload')
    const gate = createServer()
    await new Promise((resolve) => gate.listen(0, '127.0.0.1', resolve))
    const port = gate.address().port
    await new Promise((resolve) => gate.close(resolve))
    const config = path.join(home, path.relative(LEON_HOME_PATH, getProfilePaths().config))
    await mkdir(path.dirname(config), { recursive: true })
    await writeFile(config, `server:\n  port: ${port}\n`)
    const platform = `${process.platform}-${process.arch}`
    const launcher = `import { spawn } from 'node:child_process';
const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit'});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
child.on('exit',code=>process.exit(code??0));`
    const proxy = `import http from 'node:http';
http.createServer((request,response)=>{
 const forwarded=http.request(${JSON.stringify(fixture.origin)},{method:request.method,path:request.url,headers:request.headers},incoming=>{
  response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
 });
 forwarded.on('error',()=>response.writeHead(502).end());request.pipe(forwarded);
}).listen(${port},'127.0.0.1');`
    const files = {
      'package.json': JSON.stringify({ type: 'module', version: contract.minimumVersion }),
      'leon-runtime.json': JSON.stringify({ schemaVersion: 1, version: contract.minimumVersion, desktopProtocolVersion: DESKTOP_CORE_PROTOCOL_VERSION, platform, links: [] }),
      'server/dist/index.js': proxy,
      'server/dist/pre-check.js': '',
      'server/dist/distribution-setup.js': 'for(const phase of [\'running\',\'complete\']){console.log(JSON.stringify({kind:\'leon:setup\',id:\'profile\',phase,label:\'Preparing my profile\'}));await new Promise(resolve=>setTimeout(resolve,200));}',
      'scripts/run-with-managed-node.js': launcher
    }
    // Compiled profile setup must never execute a package manager on this path.
    files[process.platform === 'win32' ? 'runtime/pnpm/pnpm.exe' : 'runtime/pnpm/pnpm'] = ''
    for (const [filename, contents] of Object.entries(files)) {
      const target = path.join(payload, filename)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }
    const node = path.join(payload, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')
    await mkdir(path.dirname(node), { recursive: true })
    await cp(process.execPath, node)
    await chmod(node, 0o755)
    await cp(path.join(ROOT, '../web/dist'), path.join(payload, 'apps/web/dist'), { recursive: true })
    const archive = path.join(temporary, `leon-core-${contract.minimumVersion}-${platform}.tar.gz`)
    await create({ file: archive, cwd: payload, gzip: true, portable: true }, Object.keys(files).concat([
      path.relative(payload, node), 'apps/web/dist'
    ]))
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) {
      hash.update(chunk)
    }
    const bytes = (await stat(archive)).size
    archiveServer = createServer((request, response) => {
      response.writeHead(200, { 'content-length': bytes })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      void pipeline(createReadStream(archive, { highWaterMark: 65_536 }), new Transform({
        transform(chunk, _encoding, callback) {
          setTimeout(() => callback(null, chunk), 2)
        }
      }), response).catch(() => response.destroy())
    })
    await new Promise((resolve) => archiveServer.listen(0, '127.0.0.1', resolve))
    const asset = { name: path.basename(archive), platform, version: contract.minimumVersion, bytes,
      sha256: hash.digest('hex'), url: `http://127.0.0.1:${archiveServer.address().port}/${path.basename(archive)}` }
    app = await launchDiagnostic({ name: 'bootstrap-native', script: 'bootstrap-native.js', server: fixture.origin,
      environment: { LEON_HOME: home, LEON_CODEBASE_PATH: '' }, configuration: { bootstrap: { asset }, paint_when_hidden: true } })
    const result = await app.wait('complete')
    await app.close()
    app = undefined
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/profile-auth`)).status, 200,
      'Managed Core must survive closing the desktop')
    console.log(`Desktop bootstrap: ${result.checks.length} checks passed; managed Core survives app exit`)
  } finally {
    await app?.close()
    const configuration = await readFile(path.join(home, 'desktop/service/core.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (configuration) {
      await controlCore(configuration, 'stop')
      const deadline = Date.now() + 10_000
      while (await controlCore(configuration) && Date.now() < deadline) {
        await delay(50)
      }
    }
    archiveServer?.closeAllConnections()
    if (archiveServer) {
      await new Promise((resolve) => archiveServer.close(resolve))
    }
    await fixture.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

if (!values.only || values.only === 'transport') {
  await transport()
}
if (!values.only || values.only === 'bootstrap') {
  await bootstrap()
}
if (!values.only || values.only === 'lifecycle') {
  await lifecycle()
}
