import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UpdateService } from '@/core/ota/update-service'
import { parseReleaseNotes } from '@/core/ota/release-notes'
import { UpdatePhase } from '../../../bridges/runtime/contracts/updates'
import { runUpdate } from '../../../scripts/update/run-update.js'
import { UPDATE_FIXTURE, PUBLISHED_UPDATE_FIXTURE as release } from '../../fixtures/updates'
import { createGitUpdateFixture, prepareInstallerFixture, runGit as git } from '../../fixtures/git-update'

const execute = promisify(execFile)
const CURRENT_VERSION = '1.0.0-beta.10+dev'
const RELEASE_VERSION = '1.0.0-beta.11'
const TAG = `v${RELEASE_VERSION}`
const NOTES = UPDATE_FIXTURE.check!.release!.markdown

describe('Git-clone updates', () => {
  let home: string
  let upstream: string
  let checkout: string
  let before: string
  let statePath: string
  let service: UpdateService

  beforeEach(async () => {
    ;({ home, upstream, checkout, before, statePath, service } = await createGitUpdateFixture())
  })

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })

  it('preserves authored highlights and Markdown within each change category', () => {
    const notes = parseReleaseNotes(NOTES)
    expect(notes.highlights).toContain('### A shared home for each project')
    expect(notes.highlights).toContain('**brief and folders**')
    expect(notes.highlights).not.toContain('Full changelog')
    expect(notes.changelog.new).toContain('- Create workspaces')
    expect(notes.changelog.improvements).toContain('- Browse folders')
    expect(notes.changelog.fixes).toContain('- Keep dialogs')
    expect(notes.changelog.removed).toContain('- Remove the old Docs')
    expect(parseReleaseNotes('### Improved\n\n- Better browsing\n\n### Fixed\n\n- Correct labels').changelog)
      .toMatchObject({ improvements: '- Better browsing', fixes: '- Correct labels' })
  })

  it('selects newer published releases for the channel and never reports downgrades', async () => {
    const check = await service.check()
    expect(check).toMatchObject({ channel: 'development', canInstall: true,
      release: { version: RELEASE_VERSION, title: release.name, publishedAt: release.published_at } })
    await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({ version: '1.0.0' }))
    const stable = await service.check()
    expect(stable.channel).toBe('stable')
    expect(stable.release).toBeNull()
    const older = new UpdateService({ root: checkout, home, managed: true, releases: async (): Promise<typeof release[]> => [{ ...release, prerelease: false }] })
    expect((await older.check()).release).toBeNull()
  })

  it('pins a reviewed release, defers checkout changes until shutdown and completes after restart', async () => {
    await service.check()
    const pending = await service.prepare(TAG)
    expect(pending.state?.phase).toBe(UpdatePhase.Scheduled)
    expect(pending.state).not.toHaveProperty('root')
    expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(before)
    const installations: string[] = []
    await runUpdate(statePath, async (): Promise<void> => {
      installations.push(await git(checkout, 'rev-parse', 'HEAD'))
      expect(JSON.parse(await fs.readFile(path.join(checkout, 'package.json'), 'utf8')).version).toBe(RELEASE_VERSION)
    })
    expect(installations).toEqual([await git(upstream, 'rev-parse', 'HEAD')])
    const restarted = new UpdateService({ root: checkout, home, managed: true, releases: async (): Promise<typeof release[]> => [] })
    expect((await restarted.snapshot()).state).toMatchObject({ id: pending.state!.id, phase: UpdatePhase.Completed })
    expect((await restarted.check()).release).toBeNull()
  })

  it.each(['2.0.0-alpha.0.1', '2.0.0-beta.1', '2.0.0-rc.1', '2.0.0+dev'])(
    'continues offering published previews to a %s installation', async (version) => {
      await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({ version }))
      const previews = new UpdateService({ root: checkout, home, managed: true,
        releases: async (): Promise<typeof release[]> => [{ ...release, tag_name: 'v2.1.0-alpha.0' }] })
      expect((await previews.check()).release?.tag).toBe('v2.1.0-alpha.0')
    }
  )

  it('keeps stable installations out of previews even when GitHub labels them stable', async () => {
    await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({ version: '2.0.0' }))
    const stable = new UpdateService({ root: checkout, home, managed: true,
      releases: async (): Promise<typeof release[]> => [{ ...release, tag_name: 'v2.1.0-alpha.0', prerelease: false }] })
    expect((await stable.check()).release).toBeNull()
  })

  it('preserves local work and rejects unreviewed releases or duplicate applications', async () => {
    await expect(service.prepare(TAG)).rejects.toThrow('Check for updates again')
    await fs.writeFile(path.join(checkout, 'owner-notes.md'), 'Keep my work')
    expect((await service.check()).canInstall).toBe(false)
    await expect(service.prepare(TAG)).rejects.toThrow('local changes')
    expect(await fs.readFile(path.join(checkout, 'owner-notes.md'), 'utf8')).toBe('Keep my work')
    await fs.rm(path.join(checkout, 'owner-notes.md'))
    await service.check()
    const outcomes = await Promise.allSettled([service.prepare(TAG), service.prepare(TAG)])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  })

  it('restores the previous revision and rebuilds it after setup fails', async () => {
    await service.check()
    await service.prepare(TAG)
    const versions: string[] = []
    await expect(runUpdate(statePath, async (): Promise<void> => {
      versions.push(JSON.parse(await fs.readFile(path.join(checkout, 'package.json'), 'utf8')).version)
      if (versions.length === 1) {
        throw new Error('The build could not finish')
      }
    })).rejects.toThrow('The build could not finish')
    expect(versions).toEqual([RELEASE_VERSION, CURRENT_VERSION])
    expect(await git(checkout, 'rev-parse', 'HEAD')).toBe(before)
    expect((await service.snapshot()).state).toMatchObject({ phase: UpdatePhase.Failed, error: 'The build could not finish' })
  })

  it('runs the real worker with noninteractive setup and recorded runtime/install/build ordering', async () => {
    await service.check()
    await service.prepare(TAG)
    await prepareInstallerFixture({ checkout, statePath })
    await execute(process.execPath, [path.resolve('scripts/update/run-update.js'), statePath])
    expect(await fs.readFile(path.join(checkout, 'step-log.json'), 'utf8')).toBe('runtimes\ninstall\nsetup\n')
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).phase).toBe(UpdatePhase.Restarting)
  })

  it('hands updates through the managed launcher and boots the installed version afterward', async () => {
    await service.check()
    await service.prepare(TAG)
    const job = await prepareInstallerFixture({ checkout, statePath })
    await fs.rm(statePath)
    for (const filename of ['scripts/update/run-update.js', 'scripts/update/progress.js', 'bridges/runtime/contracts/update-status.js']) {
      const destination = path.join(checkout, filename)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(path.resolve(filename), destination)
    }
    await fs.symlink(path.resolve('node_modules/tree-kill'), path.join(checkout, 'node_modules', 'tree-kill'), 'junction')
    const node = process.platform === 'win32' ? path.join(home, 'bin', 'node', 'node.exe')
      : path.join(home, 'bin', 'node', 'bin', 'node')
    await fs.mkdir(path.dirname(node), { recursive: true })
    await fs.symlink(process.execPath, node).catch(async (): Promise<void> => {
      await fs.copyFile(process.execPath, node)
    })
    const bootLog = path.join(home, 'boots.txt')
    const server = path.join(checkout, 'scripts', 'server-fixture.js')
    await fs.writeFile(server, `import fs from 'node:fs';
      const log = process.env.LEON_UPDATE_FIXTURE_BOOTS;
      const first = !fs.existsSync(log);
      fs.appendFileSync(log, process.env.npm_package_version + '\\n');
      if (first) {
        fs.writeFileSync(process.env.LEON_UPDATE_FIXTURE_STATE, process.env.LEON_UPDATE_FIXTURE_JOB);
        process.exit(78);
      }`)
    const outcome = await execute(process.execPath, [path.resolve('scripts/run-with-managed-node.js'), server], { cwd: checkout, timeout: 30_000,
      env: { ...process.env, LEON_HOME: home, LEON_CODEBASE_PATH: checkout,
        LEON_UPDATE_FIXTURE_BOOTS: bootLog, LEON_UPDATE_FIXTURE_STATE: statePath, LEON_UPDATE_FIXTURE_JOB: JSON.stringify(job) } })
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).error, outcome.stderr).toBeNull()
    expect(await fs.readFile(bootLog, 'utf8')).toBe(`${CURRENT_VERSION}\n${RELEASE_VERSION}\n`)
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).phase).toBe(UpdatePhase.Restarting)
  })
})
