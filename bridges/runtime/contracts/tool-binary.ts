/**
 * A managed executable source, optionally preserving an archive's full layout.
 */
export type ToolBinary = string | {
  url: string
  executable?: string
  sha256?: string
}
