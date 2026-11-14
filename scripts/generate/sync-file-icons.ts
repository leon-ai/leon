import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledLanguagesInfo } from 'shiki/langs'
import { optimize, type Config } from 'svgo'

import { FileHelper } from '@/helpers/file-helper'
import { NetworkHelper } from '@/helpers/network-helper'

const REVISION = '2196346f2b52a9f5367c6f710f22b1ad2c108d27'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ICON_DIRECTORY = path.join(ROOT, 'apps/web/public/img/file-icons')
const REGISTRY_PATH = path.join(ROOT, 'apps/web/src/components/icon/file-icon-assets.json')
const LANGUAGE_PATH = path.join(ROOT, 'apps/web/src/components/icon/file-icon-languages.json')
const OPTIMIZATION: Config = {
  multipass: true,
  floatPrecision: 5,
  // Surround retained license comments with whitespace so hyphenated headers
  // remain valid XML when the serializer compacts them.
  js2svg: { commentStart: '<!-- ', commentEnd: ' -->' },
  plugins: [{
    // Standalone SVG images need the namespace that inline artwork may omit.
    name: 'addAttributesToSVGElement',
    params: { attributes: [{ xmlns: 'http://www.w3.org/2000/svg' }] }
  }, {
    name: 'preset-default',
    params: {
      overrides: {
        removeComments: false,
        // Preserve overlapping edges, transforms and original curve geometry;
        // approximating them is visible in small, antialiased file artwork.
        mergePaths: false,
        convertTransform: false,
        convertPathData: {
          applyTransforms: false,
          makeArcs: { threshold: 0, tolerance: 0 },
          straightCurves: false,
          convertToQ: false,
          floatPrecision: 8
        }
      }
    }
  }]
}

interface Association {
  name: string
  fileNames: string
  pattern: string
  icon: string
  priority?: string
  iconPack?: string
}

interface IconRegistry {
  assetVersion?: string
  rules: [string, string][]
  dark: string[]
}

/**
 * Synchronizes pinned Atom artwork and its filename rules for offline rendering.
 * Run explicitly with pnpm exec tsx scripts/generate/sync-file-icons.ts; ordinary
 * builds use the checked-in assets and never contact the upstream repository.
 */
async function syncFileIcons(): Promise<void> {
  const previous = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8')) as IconRegistry
  const previousDirectory = path.join(ICON_DIRECTORY, previous.assetVersion ?? '')
  const previousAssets = new Set([
    ...previous.rules.map(([, asset]) => asset),
    ...previous.dark.map((asset) => `${asset}_dark`)
  ])
  const previousFiles = [...previousAssets].map((asset) => path.join(previousDirectory, `${asset}.svg`))
  if ((previous.assetVersion && path.dirname(previousDirectory) !== ICON_DIRECTORY) ||
    previousFiles.some((filename) => path.dirname(filename) !== previousDirectory)) {
    throw new Error('Former file icons must remain inside the generated asset directory')
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-file-icons-'))

  try {
    const archive = path.join(temporaryDirectory, 'source.tar.gz')
    const source = path.join(temporaryDirectory, 'source')
    await NetworkHelper.downloadFile(
      `https://codeload.github.com/AtomMaterialUI/iconGenerator/tar.gz/${REVISION}`,
      archive
    )
    await FileHelper.extractArchive(archive, source, { stripComponents: 1 })

    const associations = JSON.parse(await fs.readFile(path.join(source, 'icon_associations.json'), 'utf8')) as {
      associations: { associations: { regex: { value: Association }[] } }
    }
    const sourceIcons = path.join(source, 'assets/icons/files')
    const available = new Set(await fs.readdir(sourceIcons))
    const canonicalNames = new Map([...available].map((name) => [name.toLowerCase(), name]))
    const rules: [string, string][] = []
    const patterns = new Set<string>()
    // IDE-specific alternative packs require project configuration. Ordinary file
    // associations remain available even when an IDE disables them by default.
    const definitions = associations.associations.associations.regex
      .map(({ value }) => value)
      .filter(({ iconPack }) => !iconPack)
      .sort((left, right) => Number(right.priority ?? 0) - Number(left.priority ?? 0))

    for (const definition of definitions) {
      if (patterns.has(definition.pattern)) {
        continue
      }

      // Upstream icon references use URL-style paths, independently of the host OS.
      const reference = path.posix.basename(definition.icon)
      // Match source casing explicitly so importing on macOS/Windows produces
      // the same catalog as Linux's case-sensitive filesystem.
      const filename = available.has(reference) ? reference : canonicalNames.get(reference.toLowerCase())
      if (!filename) {
        throw new Error(`Missing upstream file icon: ${reference}`)
      }
      const asset = filename.slice(0, -path.extname(filename).length)
      new RegExp(`^(?:${definition.pattern})$`, 'i')
      patterns.add(definition.pattern)
      rules.push([definition.pattern, asset])
    }
    const matchers = rules.map(([pattern]) => new RegExp(`^(?:${pattern})$`, 'i'))

    // Translate fence IDs/aliases at generation time, without importing Shiki's
    // language catalog into the browser or maintaining a second alias list.
    const languages: Record<string, { fileName: string, label: string }> = {}
    for (const language of bundledLanguagesInfo) {
      const names = [language.name, language.id, ...(language.aliases ?? [])].map((name) => name.toLowerCase())
      const definition = definitions.find((entry) => names.includes(entry.name.toLowerCase()))
      const sample = definition?.fileNames.split(',')
        .map((filename) => filename.replaceAll('*', 'code'))
        .find((filename) => new RegExp(`^(?:${definition.pattern})$`, 'i').test(filename))
      const fileName = sample ?? `code.${language.id}`
      if (!matchers.some((pattern) => pattern.test(fileName))) {
        continue
      }

      for (const alias of [language.id, ...(language.aliases ?? [])]) {
        languages[alias] = { fileName, label: language.name }
      }
    }

    const assets = [...new Set(rules.map(([, asset]) => asset))].sort()
    const dark = assets.filter((asset) => available.has(`${asset}_dark.svg`))
    const filenames = [...assets, ...dark.map((asset) => `${asset}_dark`)].map((asset) => `${asset}.svg`)

    // Validate every reference before updating the checked-in catalog.
    for (const filename of filenames) {
      if (!available.has(filename)) {
        throw new Error(`Missing upstream file icon: ${filename}`)
      }
    }

    const output = new Map<string, string>()
    const hash = createHash('sha256')
    let originalBytes = 0
    let optimizedBytes = 0
    for (const filename of filenames) {
      const original = await fs.readFile(path.join(sourceIcons, filename), 'utf8')
      const optimized = optimize(original, { ...OPTIMIZATION, path: filename }).data + '\n'
      const data = Buffer.byteLength(optimized) < Buffer.byteLength(original) ? optimized : original
      originalBytes += Buffer.byteLength(original)
      optimizedBytes += Buffer.byteLength(data)
      output.set(filename, data)
      hash.update(filename).update('\0').update(data)
    }

    // Version the collection's actual bytes, not just its upstream revision:
    // optimizer/configuration changes must invalidate browser caches too.
    const assetVersion = hash.digest('hex')
    const outputDirectory = path.join(ICON_DIRECTORY, assetVersion)
    await fs.mkdir(outputDirectory, { recursive: true })
    for (const [filename, data] of output) {
      await fs.writeFile(path.join(outputDirectory, filename), data)
    }
    await FileHelper.writeAtomicJSON(LANGUAGE_PATH, languages)
    await FileHelper.writeAtomicJSON(REGISTRY_PATH, { revision: REVISION, assetVersion, rules, dark })

    // Only remove former catalog-owned files after the replacement is complete.
    // Unrelated files and the Git index are never modified by synchronization.
    if (previous.assetVersion !== assetVersion) {
      for (const former of previousFiles) {
        await fs.rm(former, { force: true })
      }
      if (previous.assetVersion) {
        // rmdir refuses to remove a directory that contains unrelated files.
        await fs.rmdir(previousDirectory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') {
            throw error
          }
        })
      }
    }
    console.log(`Synchronized ${assets.length} Atom file icons, ${dark.length} dark variants and ${rules.length} filename rules.`)
    console.log(`SVG bytes: ${originalBytes} -> ${optimizedBytes} (${((1 - optimizedBytes / originalBytes) * 100).toFixed(1)}% smaller).`)
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await syncFileIcons()
