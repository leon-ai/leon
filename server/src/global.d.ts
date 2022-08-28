import { ChildProcessWithoutNullStreams } from 'child_process'

import TcpClient from '@/core/tcp-client'

declare global {
  var tcpServerProcess: ChildProcessWithoutNullStreams
  var tcpClient: TcpClient
}

export { }
