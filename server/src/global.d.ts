import type { ChildProcessWithoutNullStreams } from 'node:child_process'

declare global {
  var pythonTCPServerProcess: ChildProcessWithoutNullStreams
}

declare module '*.css'
declare module '*.scss'
declare module '*.sass'

export {}
