/**
 * Desktop bootstrap defaults derived from the product manifest and server configuration.
 */
export interface BootstrapContract {
  repository: string
  defaultPort: number
  minimumVersion: string
  serverVersionRange: string
  sourceVersion: string
  channel: 'preview' | 'stable'
  author: { name: string, email: string }
}

declare const contract: BootstrapContract
export default contract
