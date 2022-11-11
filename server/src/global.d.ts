import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import TCPClient from '@/core/tcp-client'

declare global {
  /* eslint-disable no-var */

  var tcpServerProcess: ChildProcessWithoutNullStreams
  var tcpClient: TCPClient
}

export {}
