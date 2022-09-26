import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import TcpClient from '@/core/tcp-client'

declare global {
  /* eslint-disable no-var */

  var tcpServerProcess: ChildProcessWithoutNullStreams
  var tcpClient: TcpClient
}

export {}
