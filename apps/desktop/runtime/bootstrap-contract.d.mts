/**
 * Public bootstrap defaults derived from the root product manifest and Core.
 */
export interface BootstrapContract {
  repository: string
  defaultPort: number
  minimumVersion: string
  coreVersionRange: string
  sourceVersion: string
  channel: 'preview' | 'stable'
  author: { name: string, email: string }
}

declare const contract: BootstrapContract
export default contract
