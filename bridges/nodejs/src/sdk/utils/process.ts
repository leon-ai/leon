import treeKill from 'tree-kill'

/**
 * Signal a process and its current descendants, tolerating processes already gone.
 * Windows uses taskkill's forced tree termination for either signal.
 */
export async function terminateProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM'
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Process ID must be a positive integer.')
  }

  await new Promise<void>((resolve, reject) => {
    treeKill(pid, signal, (error) => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code

      // taskkill reports an absent process with exit status 128.
      if (error && code !== 'ESRCH' && !(process.platform === 'win32' && Number(code) === 128)) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
