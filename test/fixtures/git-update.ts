import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { UpdateService } from '@/core/ota/update-service'
import type { GitUpdateJob } from '../../bridges/runtime/contracts/updates'
import { getUpdateStatePath } from '../../scripts/update/paths.js'
import { PUBLISHED_UPDATE_FIXTURE, UPDATE_FIXTURE } from './updates'

const execute = promisify(execFile)

export interface GitUpdateFixture {
  home: string
  upstream: string
  checkout: string
  before: string
  statePath: string
  service: UpdateService
}

/**
 * Executes only commands against a caller-owned temporary Git repository.
 */
export async function runGit(directory: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd: directory })).stdout.trim()
}

/**
 * Supplies a local published tag and an older installed clone without accessing
 * the owner's installation, network remotes or package manager.
 */
export async function createGitUpdateFixture(): Promise<GitUpdateFixture> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-update-'))
  const upstream = path.join(home, 'upstream')
  const checkout = path.join(home, 'checkout')
  await fs.mkdir(upstream)
  await runGit(upstream, 'init', '-b', 'main')
  await fs.writeFile(path.join(upstream, '.gitignore'), 'node_modules/\ninstall\nstep-log.json\n')
  for (const version of [UPDATE_FIXTURE.check!.currentVersion, UPDATE_FIXTURE.check!.release!.version]) {
    await fs.writeFile(path.join(upstream, 'package.json'), JSON.stringify({ name: 'update-fixture', type: 'module', version }))
    await runGit(upstream, 'add', '.')
    await runGit(upstream, '-c', 'user.name=Update fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', version)
    if (version === UPDATE_FIXTURE.check!.currentVersion) {
      await runGit(home, 'clone', upstream, checkout)
    }
  }
  await runGit(upstream, 'tag', PUBLISHED_UPDATE_FIXTURE.tag_name)

  return { home, upstream, checkout,
    before: await runGit(checkout, 'rev-parse', 'HEAD'), statePath: getUpdateStatePath(home, checkout),
    service: new UpdateService({ root: checkout, home, managed: true, repository: upstream,
      releases: async (): Promise<typeof PUBLISHED_UPDATE_FIXTURE[]> => [PUBLISHED_UPDATE_FIXTURE] }) }
}

/**
 * Replaces external setup work with observable scripts while leaving the actual
 * update worker, Git mutations, runtime launch and receipt handling intact.
 */
export async function prepareInstallerFixture(fixture: Pick<GitUpdateFixture, 'checkout' | 'statePath'>): Promise<GitUpdateJob> {
  const { checkout, statePath } = fixture
  const job = JSON.parse(await fs.readFile(statePath, 'utf8')) as GitUpdateJob
  job.pnpm = process.execPath
  await fs.writeFile(statePath, JSON.stringify(job))
  const cli = path.join(checkout, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  await fs.mkdir(path.dirname(cli), { recursive: true })
  await fs.writeFile(cli, 'import {pathToFileURL} from "node:url"; await import(pathToFileURL(process.argv[2]).href)')
  for (const [filename, step] of [['scripts/update/setup-runtimes.js', 'runtimes'], ['install', 'install'], ['scripts/setup/setup.js', 'setup']]) {
    const destination = path.join(checkout, filename!)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, `import fs from 'node:fs';
      if (process.stdin.isTTY) throw new Error('Setup must not prompt');
      fs.appendFileSync('step-log.json', '${step}\\n');
      ${step === 'install' ? `const {spawnSync} = await import('node:child_process');
        const child = spawnSync(process.execPath, ['scripts/setup/run-setup.js'], {stdio: 'inherit', env: process.env});
        process.exit(child.status ?? 1);` : ''}`)
  }
  await fs.copyFile(path.resolve('scripts/setup/run-setup.js'), path.join(checkout, 'scripts', 'setup', 'run-setup.js'))
  await fs.writeFile(path.join(checkout, '.git', 'info', 'exclude'), 'scripts/\nbridges/\n')

  return job
}
