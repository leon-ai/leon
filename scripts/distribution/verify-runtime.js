import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { parse, stringify } from 'yaml'

import { FileDownloader } from '../../server/dist/bridges/runtime/nodejs/file-downloader.js'
import { RUNTIME_RELEASE_ASSET, installRuntimeArchive, activateRuntime, runtimeEnvironment } from './runtime.js'

const READY_TIMEOUT_MS = 120_000

/**
 * Boots the exact release archive in a private home without source dependencies,
 * and records the artifact identity before it can be published.
 */
export async function verifyRuntime(directory) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, RUNTIME_RELEASE_ASSET), 'utf8'))
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-runtime-verification-'))
  const installation = path.join(home, 'runtimes/core')
  let child
  let diagnostics = ''
  try {
    const asset = metadata.assets[0]
    const runtime = await installRuntimeArchive({ installation, asset: { ...asset, version: metadata.version,
      url: path.join(directory, asset.name) }, download: FileDownloader.downloadFile.bind(FileDownloader) })
    const profile = 'runtime-verification'
    const profileRoot = path.join(home, 'profiles', profile)
    await fs.mkdir(profileRoot, { recursive: true })
    const sample = parse(await fs.readFile(path.join(runtime.root, 'config.sample.yml'), 'utf8'))
    const portProbe = http.createServer()
    await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    sample.server.port = port
    sample.telemetry_enabled = false
    sample.runtime.pulse_enabled = false
    await fs.writeFile(path.join(profileRoot, 'config.yml'), stringify(sample))
    const env = runtimeEnvironment(runtime, installation, { ...process.env, LEON_HOME: home, LEON_PROFILE: profile,
      LEON_SETUP_PROGRESS: 'json', UV_CACHE_DIR: path.join(home, 'cache/uv') })
    // Profile setup must run using only the archive's Node and dependencies.
    await new Promise((resolve, reject) => {
      const preparation = spawn(runtime.node, [runtime.setup], { cwd: runtime.root, env, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'] })
      preparation.stdout.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-16_384)
      })
      preparation.stderr.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk).slice(-16_384)
      })
      preparation.once('error', reject)
      preparation.once('close', (code) => code === 0 ? resolve() : reject(new Error(diagnostics)))
    })
    await activateRuntime(installation, metadata.version)
    child = spawn(runtime.node, [path.join(runtime.root, 'scripts/run-runtime.js')], {
      cwd: runtime.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.stdout.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-16_384)
    })
    child.stderr.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-16_384)
    })
    try {
      let ready = false
      const deadline = Date.now() + READY_TIMEOUT_MS
      while (Date.now() < deadline && child.exitCode === null) {
        ready = await fetch(`http://127.0.0.1:${port}/api/v1/profile-auth`, { signal: AbortSignal.timeout(1_000) })
          .then((response) => response.ok).catch(() => false)
        if (ready) {
          break
        }
        await delay(100)
      }
      assert(ready, `Packaged Core could not start: ${diagnostics}`)
      let installedBytes = 0
      let allocatedBytes = 0
      const measure = async (directory) => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name)
          if (entry.isDirectory()) {
            await measure(file)
          } else if (entry.isFile()) {
            const info = await fs.stat(file)
            installedBytes += info.size
            allocatedBytes += (info.blocks ?? 0) * 512
          }
        }
      }
      await measure(runtime.root)
      const result = { schemaVersion: 1, version: metadata.version, platform: asset.platform,
        sha256: asset.sha256, bytes: asset.bytes, runId: process.env.GITHUB_RUN_ID ?? null, commit: process.env.GITHUB_SHA ?? null,
        isolatedStartup: true, installedBytes, allocatedBytes }
      await fs.writeFile(path.join(directory, 'runtime-verification.json'), JSON.stringify(result, null, 2) + '\n')
      return result
    } finally {
      child.kill('SIGTERM')
      await closed
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  console.log(JSON.stringify(await verifyRuntime(path.resolve(process.argv[2])), null, 2))
}
