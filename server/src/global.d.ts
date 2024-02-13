import type { ChildProcessWithoutNullStreams } from 'node:child_process'

declare global {
  /* eslint-disable no-var */

  var pythonTCPServerProcess: ChildProcessWithoutNullStreams
}

export {}
