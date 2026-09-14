import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const RUNTIME_ID_LENGTH = 24
// macOS has the smaller POSIX sun_path budget, including the terminating NUL.
const MAX_SOCKET_PATH_BYTES = 103
const SOCKET_FILENAME = 'bu.sock'
const SHORT_POSIX_TEMP_DIRECTORY = '/tmp'
// These are upstream browser-harness diagnostic codes, not task-routing keywords.
const OWNER_ACTION_CODES = ['permission-blocked:', 'remote-debugging-setup:']
const MAX_DIAGNOSTIC_CHARACTERS = 16_000

/**
 * Keeps IPC short and private while persistent state and logs stay in the profile.
 */
export async function prepareBrowserUseEnvironment(settingsPath: string): Promise<NodeJS.ProcessEnv> {
  const profileDirectory = await fs.realpath(path.dirname(settingsPath))
  const identity = createHash('sha256').update(profileDirectory).digest('hex').slice(0, RUNTIME_ID_LENGTH)
  const name = `leon-bu-${process.getuid?.() ?? 'user'}-${identity}`
  let runtimeDirectory = path.join(await fs.realpath(os.tmpdir()), name)
  if (process.platform !== 'win32' && Buffer.byteLength(path.join(runtimeDirectory, SOCKET_FILENAME)) > MAX_SOCKET_PATH_BYTES) {
    // TMPDIR can itself be too deep (notably on macOS); resolve symlinks before measuring.
    runtimeDirectory = path.join(await fs.realpath(SHORT_POSIX_TEMP_DIRECTORY), name)
  }
  if (process.platform !== 'win32' && Buffer.byteLength(path.join(runtimeDirectory, SOCKET_FILENAME)) > MAX_SOCKET_PATH_BYTES) {
    throw new Error('Browser Use IPC directory exceeds the local socket path limit.')
  }
  await fs.mkdir(runtimeDirectory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  const stats = await fs.lstat(runtimeDirectory)
  // Never reuse another user's directory or follow an attacker-created symlink.
  if (!stats.isDirectory() || (process.platform !== 'win32' &&
    (stats.uid !== process.getuid?.() || (stats.mode & 0o077) !== 0))) {
    throw new Error(`Browser Use IPC directory is not private: ${runtimeDirectory}`)
  }
  const home = path.join(profileDirectory, 'runtime')
  return {
    BH_HOME: home,
    BH_RUNTIME_DIR: runtimeDirectory,
    BH_RUNTIME_DIR_SHARED: '0',
    BH_TMP_DIR: path.join(home, 'tmp'),
    BH_TMP_DIR_SHARED: '0'
  }
}

/**
 * Preserves CLI failure evidence without treating every local error as missing consent.
 */
export function describeBrowserUseReadinessFailure(result: {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}, logPath: string): { requiresOwnerAction: boolean, message: string } {
  const diagnostic = [result.stderr, result.stdout].filter(Boolean).join('\n')
  return {
    requiresOwnerAction: OWNER_ACTION_CODES.some((code) => diagnostic.includes(code)),
    message: `Browser Use CLI readiness failed (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}). ${diagnostic.slice(0, MAX_DIAGNOSTIC_CHARACTERS)} See daemon log: ${logPath}`
  }
}
