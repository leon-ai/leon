import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { server: { type: 'string' } } })

try {
  const build = JSON.parse(await readFile(path.join(ROOT, '.artifacts/build.json'), 'utf8'))
  const binary = process.platform === 'darwin'
    ? path.join(build.output, `${build.bundleName}.app`, 'Contents/MacOS', build.executableName)
    : path.join(build.output, `${build.executableName}${process.platform === 'win32' ? '.exe' : ''}`)
  await access(binary)

  const child = spawn(binary, [], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      LEON_CODEBASE_PATH: path.resolve(process.env.LEON_CODEBASE_PATH?.trim() || fileURLToPath(new URL('../../../', import.meta.url))),
      ...(values.server ? { LEON_DESKTOP_SERVER: values.server } : {})
    }
  })
  child.once('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'Desktop build not found. Run pnpm build:desktop first.'
    : error.message)
  process.exitCode = 1
}
