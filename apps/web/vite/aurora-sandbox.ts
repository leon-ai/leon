import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { build } from 'esbuild'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import type { HtmlTagDescriptor, Plugin } from 'vite'

const ENTRIES = {
  'virtual:aurora-sandbox': '../src/components/aurora-answer/generated/runtime.tsx',
  'virtual:aurora-charts': '../src/components/aurora-answer/generated/charts.ts',
  'virtual:aurora-controls': '../src/components/aurora-answer/generated/controls.ts',
  'virtual:aurora-export': '../src/components/aurora-answer/generated/export.ts'
}

/**
 * Bundles trusted browser runtimes as inert strings. Only the isolated document
 * executes them; no model source or chart engine enters the application runtime.
 */
export function auroraSandbox(): Plugin {
  const bundles = new Map<string, Promise<string>>()
  const moduleFiles = new Map<string, string>()

  return {
    name: 'aurora-sandbox',
    resolveId(id): string | undefined {
      return Object.hasOwn(ENTRIES, id) || id.startsWith('virtual:aurora-part/') ? `\0${id}` : undefined
    },
    async load(id): Promise<string | undefined> {
      if (id.startsWith('\0virtual:aurora-part/')) {
        return `export default ${JSON.stringify(moduleFiles.get(id.slice('\0virtual:aurora-part/'.length)))}`
      }
      const key = id.slice(1) as keyof typeof ENTRIES
      if (!id.startsWith('\0') || !Object.hasOwn(ENTRIES, key)) {
        return undefined
      }
      let pending = bundles.get(key)
      if (!pending) {
        const optional = key !== 'virtual:aurora-sandbox'
        const controls = key === 'virtual:aurora-controls'
        const group = key.slice('virtual:aurora-'.length)
        pending = build({
          entryPoints: [fileURLToPath(new URL(ENTRIES[key], import.meta.url))],
          bundle: true, write: false, minify: true, format: optional ? 'esm' : 'iife', platform: 'browser',
          splitting: optional, metafile: true, outdir: 'aurora-engine',
          target: 'es2022', jsx: 'automatic', loader: { '.sass': 'empty' },
          define: { 'process.env.NODE_ENV': '"production"' },
          // Optional controls must use the frame's existing React dispatcher,
          // not ship a second React/DOM runtime or access the parent application.
          plugins: controls ? [{ name: 'frame-react', setup(builder): void {
            const shared = { react: { global: 'React', exports: Object.keys(React) },
              'react-dom': { global: 'auroraReactDOM', exports: Object.keys(ReactDOM) } }
            builder.onResolve({ filter: /^(react|react-dom)$/ }, (args) => ({ path: args.path, namespace: 'frame-react' }))
            builder.onLoad({ filter: /.*/, namespace: 'frame-react' }, (args) => {
              const source = shared[args.path as keyof typeof shared]

              return { contents: `const runtime = window.${source.global};export default runtime;${source.exports
                .filter((name) => name !== 'default' && name !== 'module.exports')
                .map((name) => `export const ${name}=runtime[${JSON.stringify(name)}];`).join('')}` }
            })
          } }] : []
        }).then((result) => {
          for (const input of Object.keys(result.metafile!.inputs)) {
            if (!input.startsWith('frame-react:')) {
              this.addWatchFile(fileURLToPath(new URL(`../../../${input}`, import.meta.url)))
            }
          }
          if (!optional) {
            return `export default ${JSON.stringify(result.outputFiles[0]!.text)}`
          }
          const files = result.outputFiles.map((file) => {
            const name = basename(file.path)
            const metadata = result.metafile!.outputs[`aurora-engine/${name}`]!
            moduleFiles.set(`${group}/${name}`, JSON.stringify({ source: file.text,
              imports: metadata.imports.map((item) => basename(item.path)) }))

            return `${JSON.stringify(name)}: () => import(${JSON.stringify(`virtual:aurora-part/${group}/${name}`)})`
          })

          return `const files = {${files.join(',')}}
export default {
  entry: '${group}.js',
  async load() {
    const modules = await Promise.all(Object.entries(files).map(async ([name, load]) => {
      const { default: source } = await load()
      return [name, JSON.parse(source)]
    }))
    return Object.fromEntries(modules)
  }
}`
        })
        bundles.set(key, pending)
      }

      return await pending
    },
    handleHotUpdate(context): void {
      if (context.file.includes('/aurora/') || context.file.includes('/generated/')) {
        bundles.clear()
        moduleFiles.clear()
        for (const module of context.server.moduleGraph.idToModuleMap.values()) {
          if (module.id?.startsWith('\0virtual:aurora-')) {
            context.server.moduleGraph.invalidateModule(module)
          }
        }
        context.server.ws.send({ type: 'full-reload' })
      }
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      // A frame's own CSP does not prohibit self-navigation. This ancestor policy
      // also blocks generated code from navigating its frame to a network URL.
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy', content: 'frame-src blob:'
      }, injectTo: 'head-prepend' }]
    }
  }
}
