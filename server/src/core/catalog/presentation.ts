import fs from 'node:fs/promises'
import path from 'node:path'

import { CatalogMaintenance, type CatalogMetadata } from '@/schemas/catalog-metadata-schemas'
import type { CatalogPresentation } from './types'

const MAXIMUM_DOCUMENT_BYTES = 256 * 1_024
const MAXIMUM_MEDIA_BYTES = 5 * 1_024 * 1_024
const DOCUMENT_FILES = { readme: 'README.md', changelog: 'CHANGELOG.md' } as const
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml'
}

/**
 * Resolves only package-local assets, including symlinks, without exposing other
 * profile files. SVGs are served as isolated images, never injected into the DOM.
 */
async function localFile(directory: string, relative: string, maximum: number): Promise<string> {
  const root = await fs.realpath(directory)
  const filename = await fs.realpath(path.resolve(root, relative))
  const inside = path.relative(root, filename)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('This file is outside the package.')
  }
  const stat = await fs.stat(filename)
  if (!stat.isFile() || stat.size > maximum) {
    throw new Error('This file cannot be displayed.')
  }

  return filename
}

/**
 * Exposes authored presentation only; local trust is never inferred from an
 * owner's self-declared official label or from a remote server's identity.
 */
export async function catalogPresentation(metadata: Partial<CatalogMetadata>, directory: string, trusted: boolean, endpoint: string): Promise<CatalogPresentation> {
  const documents = {
    readme: await localFile(directory, DOCUMENT_FILES.readme, MAXIMUM_DOCUMENT_BYTES).then(() => true, () => false),
    changelog: await localFile(directory, DOCUMENT_FILES.changelog, MAXIMUM_DOCUMENT_BYTES).then(() => true, () => false)
  }
  const logo = metadata.logo === 'logo.svg' && await localFile(directory, metadata.logo, MAXIMUM_DOCUMENT_BYTES).then(() => true, () => false)

  return {
    ...(metadata.author ? { author: metadata.author } : {}),
    ...(metadata.maintainers ? { maintainers: metadata.maintainers } : {}),
    ...(metadata.distribution ? { distribution: metadata.distribution } : {}),
    ...(trusted && metadata.maintenance ? { maintenance: metadata.maintenance } :
      metadata.maintenance === CatalogMaintenance.Community ? { maintenance: CatalogMaintenance.Community } : {}),
    documents,
    ...(logo ? { logoUrl: `${endpoint}/assets/logo.svg` } : {})
  }
}

/**
 * Documentation is loaded only when opened. Relative screenshots resolve through
 * the same authenticated, bounded asset route; executable file types are refused.
 */
export async function readCatalogDocument(directory: string, document: string, endpoint: string): Promise<{ text: string }> {
  if (!Object.hasOwn(DOCUMENT_FILES, document)) {
    throw new Error('Unknown document.')
  }
  const filename = await localFile(directory, DOCUMENT_FILES[document as keyof typeof DOCUMENT_FILES], MAXIMUM_DOCUMENT_BYTES)
  const text = await fs.readFile(filename, 'utf8')
  const { Marked } = await import('marked')
  const replacements: Array<{ raw: string, replacement: string }> = []
  const parser = new Marked()
  const tokens = parser.lexer(text)
  parser.walkTokens(tokens, (token): void => {
    if (token.type === 'image') {
      const href = token.href.startsWith('./') ? token.href.slice(2) : token.href
      // Catalog browsing does not contact arbitrary image hosts or render local
      // file paths. Explicit outbound links remain ordinary owner actions.
      const destination = href.startsWith('media/') ? `${endpoint}/assets/${href}` : ''
      replacements.push({ raw: token.raw, replacement: destination ? `![${token.text}](${destination})` : token.text })
    }
  })
  let output = text
  for (const { raw, replacement } of replacements) {
    output = output.split(raw).join(replacement)
  }

  return { text: output }
}

/**
 * Limits assets to a declared logo or non-executable media beneath media/.
 */
export async function readCatalogAsset(directory: string, asset: string, logo?: string): Promise<{ body: Buffer, type: string }> {
  const extension = path.extname(asset).toLowerCase()
  const type = MEDIA_TYPES[extension]
  if (!type || !(asset === 'logo.svg' && logo === asset || asset.startsWith('media/'))) {
    throw new Error('Unknown package asset.')
  }
  const filename = await localFile(directory, asset, MAXIMUM_MEDIA_BYTES)

  return { body: await fs.readFile(filename), type }
}
