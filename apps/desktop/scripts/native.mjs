import { spawn, execFile, execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const ARTIFACTS = path.join(ROOT, '.artifacts')

/**
 * Compiles optional macOS diagnostics before entering a measured interval.
 */
export async function swiftHelper(name) {
  const source = path.join(ROOT, 'scripts', `${name}.swift`)
  const binary = path.join(ARTIFACTS, name)
  await mkdir(ARTIFACTS, { recursive: true })
  const previous = await stat(binary).catch(() => null)
  if (!previous || previous.mtimeMs < (await stat(source)).mtimeMs) {
    execFileSync('swiftc', ['-O', source, '-o', binary], { stdio: 'inherit' })
  }
  return binary
}

/**
 * Owns an explicitly diagnostic app instance without changing window focus.
 */
export async function launchDiagnostic({ name, script, server, configuration = {}, environment = {}, nativeThrottling = false,
  dataDirectory: retainedDataDirectory }) {
  await mkdir(ARTIFACTS, { recursive: true })
  const build = JSON.parse(await readFile(path.join(ARTIFACTS, 'diagnostics-build.json'), 'utf8'))
  const report = path.join(ARTIFACTS, `${name}.json`)
  await rm(report, { force: true })
  const combined = path.join(ARTIFACTS, `${name}.js`)
  await writeFile(combined, (await Promise.all(['background.js', 'native-helpers.js', script]
    .map((filename) => readFile(path.join(ROOT, 'test', filename), 'utf8')))).join('\n'))
  const config = path.join(ARTIFACTS, `${name}.config.json`)
  await writeFile(config, JSON.stringify({ ...configuration, background: true }))
  // Delete Chromium's isolated data after exit, outside the host's quit path.
  // Extra diagnostic I/O during shutdown would conceal promise timing races.
  const dataDirectory = retainedDataDirectory ?? await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-'))
  const env = { ...process.env, LEON_HOME: path.join(dataDirectory, 'core-home'), ...environment,
    LEON_DESKTOP_SERVER: server,
    LEON_DESKTOP_SMOKE_SCRIPT: combined,
    LEON_DESKTOP_REPORT_PATH: report,
    LEON_DESKTOP_DIAGNOSTIC_CONFIG: config,
    LEON_DESKTOP_DIAGNOSTIC_DATA: dataDirectory,
    LEON_DESKTOP_BACKGROUND: '1',
    LEON_DESKTOP_NATIVE_THROTTLING: nativeThrottling ? '1' : '0' }
  const bundle = path.join(build.output, `${build.bundleName}.app`)
  const binary = process.platform === 'darwin'
    ? await swiftHelper('launch-macos')
    : path.join(build.output, `${build.executableName}${process.platform === 'win32' ? '.exe' : ''}`)
  const log = createWriteStream(path.join(ARTIFACTS, `${name}.log`))
  const child = spawn(binary, process.platform === 'darwin' ? [bundle] : [], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stderr.pipe(log, { end: false })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  let pid = child.pid
  if (process.platform === 'darwin') {
    pid = await new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout })
      child.once('error', reject)
      child.once('exit', () => reject(new Error('Diagnostic app exited before reporting its PID')))
      lines.once('line', (line) => {
        lines.close()
        const value = Number(line)
        if (Number.isInteger(value) && value > 0) {
          resolve(value)
        } else {
          reject(new Error('The diagnostic launcher returned an invalid PID'))
        }
      })
    })
  } else {
    child.stdout.pipe(log, { end: false })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  }
  return { pid, report,
    async quit() {
      if (process.platform !== 'darwin') {
        throw new Error('Native application termination is available only on macOS')
      }
      await promisify(execFile)(binary, ['--quit', String(pid)], { timeout: 10_000 })
    },
    async waitForExit(timeout = 10_000) {
      let timer
      try {
        await Promise.race([exited, new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Desktop did not quit after an explicit quit action')), timeout)
        })])
      } finally {
        clearTimeout(timer)
      }
    },
    async wait(phase, timeout = 100_000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const result = await readFile(report, 'utf8').then(JSON.parse).catch(() => null)
        if (result && (!result.passed || !phase || result.phase === phase)) {
          if (!result.passed) {
            throw new Error(JSON.stringify(result))
          }
          return result
        }
        if (child.exitCode !== null) {
          throw new Error(`Diagnostic app exited (${child.exitCode}); inspect ${name}.log`)
        }
        await delay(50)
      }
      throw new Error(`Diagnostic check timed out: ${name}`)
    },
    async close() {
      const stop = (signal) => {
        try {
          process.kill(pid, signal)
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error
          }
        }
      }
      stop('SIGTERM')
      const kill = setTimeout(() => stop('SIGKILL'), 10_000)
      try {
        await exited
      } finally {
        clearTimeout(kill)
        log.end()
        if (!retainedDataDirectory) {
          await rm(dataDirectory, { recursive: true, force: true })
        }
      }
    }
  }
}
