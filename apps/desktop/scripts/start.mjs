import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SANDBOX_FAILURE = 'The SUID sandbox helper binary was found, but is not configured correctly.'
const USER_NAMESPACE_RESTRICTION = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
const APPARMOR_PARSER = '/usr/sbin/apparmor_parser'
const APPARMOR_DIRECTORY = '/etc/apparmor.d'
const SAFE_ATTACHMENT_PATH = /^\/[\p{L}\p{N}/._ -]+$/u
const { values } = parseArgs({ options: { server: { type: 'string' } } })

function run(command, args, options, inspectStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)

    child.stderr?.on('data', inspectStderr)
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

async function offerSandboxSetup(binary) {
  const restriction = await readFile(USER_NAMESPACE_RESTRICTION, 'utf8').catch(() => '')
  if (restriction.trim() !== '1') {
    return false
  }

  const attachment = await realpath(binary)
  // AppArmor interprets glob syntax even in quoted attachment paths.
  if (!SAFE_ATTACHMENT_PATH.test(attachment)) {
    console.error('I need a checkout path without AppArmor pattern characters to configure the desktop sandbox.')
    return false
  }

  console.error(`AppArmor restricts the user namespaces I need for my desktop sandbox. I can install a system profile for "${attachment}" with sudo.`)
  if (!process.stdin.isTTY || !process.stderr.isTTY || process.getuid() === 0) {
    console.error('Run pnpm start:desktop as your regular user in an interactive terminal to set up my sandbox.')
    return false
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  let answer
  try {
    answer = await prompt.question('Install the AppArmor profile and retry? [Y/n] ')
  } finally {
    prompt.close()
  }
  if (!['', 'y', 'yes'].includes(answer.trim().toLowerCase())) {
    return false
  }

  const id = createHash('sha256').update(attachment).digest('hex')
  const name = `leon-desktop-${id}`
  const target = path.join(APPARMOR_DIRECTORY, name)
  const directory = await mkdtemp(path.join(tmpdir(), 'leon-desktop-apparmor-'))
  const source = path.join(directory, name)

  try {
    await writeFile(source, [
      'abi <abi/4.0>,',
      'include <tunables/global>',
      `profile ${name} "${attachment}" flags=(unconfined) {`,
      '  userns,',
      '}',
      ''
    ].join('\n'), { mode: 0o600 })

    // Parse first so an unsupported policy does not persist across reboot.
    for (const command of [
      [APPARMOR_PARSER, '--skip-kernel-load', '--debug', source],
      ['/usr/bin/install', '-m', '0644', '--', source, target],
      [APPARMOR_PARSER, '--replace', target]
    ]) {
      if (await run('sudo', command, { stdio: 'inherit' }) !== 0) {
        throw new Error('I could not install my desktop AppArmor profile.')
      }
    }

    return true
  } finally {
    await rm(source, { force: true })
    await rm(directory, { recursive: true, force: true })
  }
}

try {
  const build = JSON.parse(await readFile(path.join(ROOT, '.artifacts/build.json'), 'utf8'))
  const binary = process.platform === 'darwin'
    ? path.join(build.output, `${build.bundleName}.app`, 'Contents/MacOS', build.executableName)
    : path.join(build.output, `${build.executableName}${process.platform === 'win32' ? '.exe' : ''}`)
  await access(binary)

  const options = {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      LEON_CODEBASE_PATH: path.resolve(process.env.LEON_CODEBASE_PATH?.trim() || fileURLToPath(new URL('../../../', import.meta.url))),
      ...(values.server ? { LEON_DESKTOP_SERVER: values.server } : {})
    }
  }

  if (process.platform !== 'linux') {
    process.exitCode = await run(binary, [], options)
  } else {
    let sandboxFailed = false
    let stderrTail = ''
    const status = await run(binary, [], { ...options, stdio: ['inherit', 'inherit', 'pipe'] }, (chunk) => {
      process.stderr.write(chunk)
      const output = stderrTail + chunk.toString()

      sandboxFailed ||= output.includes(SANDBOX_FAILURE)
      stderrTail = output.slice(1 - SANDBOX_FAILURE.length)
    })
    process.exitCode = status !== 0 && sandboxFailed && await offerSandboxSetup(binary)
      ? await run(binary, [], options)
      : status
  }
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'Desktop build not found. Run pnpm build:desktop first.'
    : error.message)
  process.exitCode = 1
}
