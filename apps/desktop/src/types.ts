import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DesktopAttachmentFile } from '../../../bridges/runtime/contracts/desktop-client'

export type HostError = Error & { code?: string, status?: number }
export type ReadBody = (request: IncomingMessage, maximumBytes?: number) => Promise<Buffer>
export type HostAPI = (request: IncomingMessage, response: ServerResponse, url: URL, readBody: ReadBody) => Promise<void>
export interface FileGrants {
  files: DesktopAttachmentFile[]
  issues: string[]
}

/**
 * Persisted control credentials belong to the native host, never the renderer.
 */
export interface ServiceConfiguration {
  node: string
  pnpm?: string | undefined
  runtimeHome?: string | undefined
  codebase: string
  directory: string
  controlPath: string
  controlToken: string
  environment: NodeJS.ProcessEnv
}

/**
 * Diagnostic capabilities exist only in explicitly packaged diagnostic builds.
 */
export interface DiagnosticConfiguration {
  viewport?: { width: number, height: number }
  paint_when_hidden?: boolean
  clipboard_files?: string[]
  bootstrap?: { asset: import('../runtime/bootstrap-runtime.mjs').RuntimeAsset }
}
