import { spawn } from 'node:child_process'

const MODULE_MOCKS_FLAG = '--experimental-test-module-mocks'

/**
 * Node disallows this test-only flag in NODE_OPTIONS. Re-exec only the Core
 * fixture process, forwarding IPC readiness and its actual lifecycle exit code.
 */
export async function ensureModuleMocks() {
  if (process.execArgv.includes(MODULE_MOCKS_FLAG)) {
    return
  }
  const child = spawn(process.execPath, [MODULE_MOCKS_FLAG, ...process.execArgv, ...process.argv.slice(1)], {
    env: process.env, stdio: process.send ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', windowsHide: true
  })
  if (process.send) {
    child.on('message', (message) => process.send?.(message))
  }
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  process.on('SIGINT', () => child.kill('SIGINT'))
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  process.exit(result)
}
