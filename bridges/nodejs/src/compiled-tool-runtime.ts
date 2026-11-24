import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const outputRoot = fileURLToPath(new URL('../../../', import.meta.url))
const codebaseRoot = path.resolve(outputRoot, '..', '..')

// Compiled modules keep their relative imports in the build output. Resolve
// package imports from the owning source directory so native dependencies keep
// the SDK or tool's own installed version and filesystem layout.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const { parentURL } = context
    if (!parentURL?.startsWith('file:') || specifier.startsWith('.') ||
        path.isAbsolute(specifier) || URL.canParse(specifier)) {
      return nextResolve(specifier, context)
    }

    const relative = path.relative(outputRoot, fileURLToPath(parentURL))
    const [owner] = relative.split(path.sep)
    if (owner !== 'bridges' && owner !== 'tools') {
      return nextResolve(specifier, context)
    }

    return nextResolve(specifier, {
      ...context, parentURL: pathToFileURL(path.join(codebaseRoot, relative)).href
    })
  }
})

await import('./tool-runtime')
