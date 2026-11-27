import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const MOUNTINFO = '/proc/self/mountinfo'
const MOUNT_ESCAPE = /\\([0-7]{3})/g
const GLOB_META = /[\\*?[\]{}]/u
const REMOTE_FILESYSTEMS = new Set([
  '9p', 'afs', 'ceph', 'cifs', 'davfs', 'nfs', 'nfs4', 'smb3',
  'fuse.davfs', 'fuse.gvfsd-fuse', 'fuse.rclone', 'fuse.s3fs', 'fuse.sshfs'
])
const DISCOVERY_TIMEOUT_MS = 8_000
const WINDOWS_SYNC_ROOTS = [
  '$ErrorActionPreference = \'Stop\'',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  '$manager = [Windows.Storage.Provider.StorageProviderSyncRootManager, Windows.Storage, ContentType=WindowsRuntime]',
  '$roots = @(foreach ($root in $manager::GetCurrentSyncRoots()) { $root.Path.Path })',
  'ConvertTo-Json -InputObject $roots -Compress'
].join('; ')
const MACOS_LOCAL_SEARCH = [
  'import ctypes, json, os, stat, sys',
  'libc = ctypes.CDLL(None, use_errno=True)',
  'IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES = 3',
  'IOPOL_SCOPE_PROCESS = 0',
  'IOPOL_MATERIALIZE_DATALESS_FILES_OFF = 1',
  'status = libc.setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_PROCESS, IOPOL_MATERIALIZE_DATALESS_FILES_OFF)',
  'if status != 0:',
  '    raise OSError(ctypes.get_errno(), "Cannot disable dataless file downloads")',
  'options = json.loads(sys.argv[1])',
  'if options.get("cwd"):',
  '    os.chdir(options["cwd"])',
  'for source in options.get("paths", []):',
  '    mode = os.stat(source).st_mode',
  '    if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):',
  '        raise ValueError("Not a regular file or directory: " + source)',
  'os.execv(sys.argv[2], sys.argv[2:])'
].join('\n')

function containsPath(root: string, entry: string): boolean {
  const relative = path.relative(root, entry)

  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Read platform registrations once per search rather than querying individual
 * files through a provider. Mount paths are decoded before comparing them.
 */
export async function getRemoteSearchRoots(signal?: AbortSignal): Promise<string[]> {
  if (process.platform === 'win32') {
    const windows = process.env['SystemRoot']
    const powershell = windows
      ? path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    const { stdout } = await promisify(execFile)(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SYNC_ROOTS
    ], { signal, timeout: DISCOVERY_TIMEOUT_MS, windowsHide: true })
    const roots: unknown = JSON.parse(stdout)
    if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string' && path.isAbsolute(root))) {
      throw new Error('Windows returned invalid cloud sync roots.')
    }

    return roots.map((root: string) => path.resolve(root))
  }

  if (process.platform === 'linux') {
    const mounts = await fs.readFile(MOUNTINFO, { encoding: 'utf8', signal })

    return mounts.split('\n').flatMap((entry) => {
      const separator = entry.indexOf(' - ')
      if (separator === -1) {
        return []
      }

      const filesystem = entry.slice(separator + 3).split(' ', 1)[0]!
      const location = entry.slice(0, separator).split(' ', 5)[4]

      return location && REMOTE_FILESYSTEMS.has(filesystem)
        ? [location.replace(MOUNT_ESCAPE, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))]
        : []
    })
  }

  return []
}

/**
 * Exclude remote scopes before launching a recursive walker. A caller that
 * cannot pass exclusions can only search roots disjoint from remote storage.
 */
export function localSearchScope(
  roots: string[],
  remoteRoots: string[],
  canExcludeDescendants: boolean
): { paths: string[], excluded: string[], globs: string[], cwd?: string } {
  const volumes = new Set(roots.map((root) => path.parse(root).root.toLowerCase()))
  const cwd = canExcludeDescendants && volumes.size === 1 ? path.parse(roots[0]!).root : undefined
  const excluded = new Set<string>()
  const globs = new Set<string>()
  const paths = roots.filter((root) => {
    const parent = remoteRoots.find((remote) => containsPath(remote, root))
    if (parent) {
      excluded.add(root)
      return false
    }

    const children = remoteRoots.filter((remote) => containsPath(root, remote))
    const patterns = children.map((remote) => cwd ? path.relative(cwd, remote).split(path.sep).join('/') : '')
    if (patterns.some((pattern) => !pattern || GLOB_META.test(pattern))) {
      excluded.add(root)
      return false
    }

    for (const [index, remote] of children.entries()) {
      excluded.add(remote)
      globs.add(`!/${patterns[index]}`)
    }

    return true
  })

  return { paths, excluded: [...excluded], globs: [...globs], ...(globs.size ? { cwd } : {}) }
}

/**
 * Start macOS search processes with dataless materialization disabled before
 * their first filesystem access. Other hosts use their normal executable.
 */
export function localSearchCommand(
  binary: string,
  args: string[],
  python: () => string,
  options: { cwd?: string, paths?: string[] } = {}
): {
  binary: string
  args: string[]
  cwd?: string
} {
  return process.platform === 'darwin'
    ? { binary: python(), args: ['-I', '-c', MACOS_LOCAL_SEARCH, JSON.stringify(options), binary, ...args] }
    : { binary, args, cwd: options.cwd }
}
