import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

/**
 * Copies installed production dependency graphs with their built native outputs.
 * Independent bridge manifests keep their own versions and runtime ownership.
 */
export async function copyRuntimeDependencies(source, destination) {
  const known = new Map()
  const queue = []
  async function copyPackage(directory) {
    const canonical = await fs.realpath(directory)
    if (known.has(canonical)) {
      return known.get(canonical)
    }
    const key = createHash('sha256').update(path.relative(source, canonical)).digest('hex').slice(0, 24)
    const target = path.join(destination, '.leon-packages', key)
    known.set(canonical, target)
    await fs.cp(canonical, target, { recursive: true, verbatimSymlinks: true,
      filter: (name) => name === canonical || path.relative(canonical, name).split(path.sep)[0] !== 'node_modules' })
    queue.push({ source: canonical, target })
    return target
  }
  async function linkDependencies(directory, modules) {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    const require = createRequire(path.join(directory, 'package.json'))
    const optional = new Set([...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta.optional).map(([name]) => name)])
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).sort()) {
      const search = require.resolve.paths(name)
      if (!search) {
        continue
      }
      let packagePath
      for (const prefix of search) {
        const candidate = path.join(prefix, name)
        if ((await fs.stat(path.join(candidate, 'package.json')).catch(() => null))?.isFile()) {
          packagePath = candidate
          break
        }
      }
      if (!packagePath && optional.has(name)) {
        continue
      }
      assert(packagePath, `Missing installed production dependency ${name} in ${directory}`)
      const target = await copyPackage(packagePath)
      const alias = path.join(modules, name)
      await fs.mkdir(path.dirname(alias), { recursive: true })
      await fs.symlink(process.platform === 'win32' ? target : path.relative(path.dirname(alias), target), alias,
        process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
  await fs.mkdir(destination, { recursive: true })
  await linkDependencies(source, destination)
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index]
    await linkDependencies(item.source, path.join(item.target, 'node_modules'))
  }
}

/**
 * Records only internal links so owners can restore directory junctions on Windows.
 */
export async function runtimeDependencyLinks(payload) {
  payload = await fs.realpath(payload)
  const links = []
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(absolute)
        assert(target.startsWith(`${payload}${path.sep}`), `A runtime link leaves its payload: ${absolute}`)
        links.push({ path: path.relative(payload, absolute).split(path.sep).join('/'),
          target: path.relative(payload, target).split(path.sep).join('/'), directory: (await fs.stat(target)).isDirectory() })
      } else if (entry.isDirectory()) {
        await visit(absolute)
      }
    }
  }
  await visit(payload)
  return links
}
