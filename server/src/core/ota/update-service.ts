import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'


import { CODEBASE_PATH, LEON_HOME_PATH, GITHUB_URL } from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { FileDownloader } from '@@/bridges/runtime/nodejs/file-downloader'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { currentRuntime, readRuntimeMetadata, selectRuntimeAsset, installRuntimeArchive, RUNTIME_RELEASE_ASSET } from '@@/scripts/distribution/runtime.js'
import { getUpdateStatePath } from '@@/scripts/update/paths.js'
import { parseReleaseNotes } from './release-notes'
import { createReleaseSource } from './release-source'
import { recordUpdateProgress, finishUpdateProgress } from '@@/scripts/update/progress.js'
import { UpdatePhase, type UpdateCheck, type UpdateJob, type UpdateSnapshot, type RuntimeUpdateJob } from '@@/bridges/runtime/contracts/updates'

const execute = promisify(execFile)
const semver = createRequire(import.meta.url)('semver') as {
  valid: (value: string) => string | null
  gt: (left: string, right: string) => boolean
  eq: (left: string, right: string) => boolean
  prerelease: (value: string) => readonly (string | number)[] | null
}
const RELEASES_URL = `https://api.github.com/repos${new URL(GITHUB_URL).pathname}/releases`
const REQUEST_TIMEOUT_MS = 15_000
const MAXIMUM_RELEASE_NOTES = 100_000
const MAXIMUM_RELEASES = 100

interface PublishedRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
}

interface UpdateServiceOptions {
  root?: string
  home?: string
  managed?: boolean
  repository?: string
  releases?: (development: boolean) => Promise<PublishedRelease[]>
  runtimeHome?: string
  runtimeAssets?: (tag: string) => Promise<{ manifest: unknown, baseURL: string }>
}

/**
 * Owns one host-wide update decision; profiles authenticate requests but never
 * choose command text, paths, remotes or revisions to execute.
 */
export class UpdateService {
  private readonly root: string
  private readonly statePath: string
  private readonly repository: string
  private readonly managed: boolean
  private readonly releases: (development: boolean) => Promise<PublishedRelease[]>
  private checking: Promise<UpdateCheck> | null = null
  private latest: UpdateCheck | null = null
  private applying = false
  private preparation: Promise<void> | null = null
  private readonly runtimeHome: string | undefined
  private readonly runtimeAssets: NonNullable<UpdateServiceOptions['runtimeAssets']>
  private runtimeAsset: RuntimeUpdateJob['asset'] | null = null

  public constructor(options: UpdateServiceOptions = {}) {
    this.root = path.resolve(options.root ?? CODEBASE_PATH)
    this.runtimeHome = options.runtimeHome ?? process.env['LEON_RUNTIME_HOME']
    this.statePath = getUpdateStatePath(options.home ?? LEON_HOME_PATH, this.root, this.runtimeHome)
    this.repository = options.repository ?? `${GITHUB_URL}.git`
    this.managed = options.managed ?? process.env['LEON_MANAGED_LAUNCHER'] === 'true'
    this.runtimeAssets = options.runtimeAssets ?? (async (tag): Promise<{ manifest: unknown, baseURL: string }> => {
      const repository = new URL(this.repository)
      if (repository.pathname.endsWith('.git')) {
        repository.pathname = repository.pathname.slice(0, -4)
      }
      const baseURL = `${repository.href}/releases/download/${encodeURIComponent(tag)}/`
      return { manifest: await readRuntimeMetadata(new URL(RUNTIME_RELEASE_ASSET, baseURL)), baseURL }
    })
    const read = createReleaseSource(path.dirname(this.statePath))
    this.releases = options.releases ?? (async (development: boolean): Promise<PublishedRelease[]> => {
      if (!development) {
        try {
          return [await read<PublishedRelease>(`${RELEASES_URL}/latest`)]
        } catch (error) {
          if ((error as { status?: number }).status !== 404) {
            throw error
          }
        }
      }
      return read<PublishedRelease[]>(`${RELEASES_URL}?per_page=${MAXIMUM_RELEASES}`)
    })
  }

  private async git(...args: string[]): Promise<string> {
    return (await execute('git', args, {
      cwd: this.root, timeout: REQUEST_TIMEOUT_MS, maxBuffer: 1_048_576, windowsHide: true
    })).stdout.trim()
  }

  private async version(): Promise<string> {
    return (JSON.parse(await fs.readFile(path.join(this.root, 'package.json'), 'utf8')) as { version: string }).version
  }

  private async job(): Promise<UpdateJob | null> {
    try {
      return JSON.parse(await fs.readFile(this.statePath, 'utf8')) as UpdateJob
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  /**
   * Exposes public status without publishing local paths or setup environment.
   */
  public async snapshot(): Promise<UpdateSnapshot> {
    const job = await this.job()
    if (job?.phase === UpdatePhase.Restarting && !('kind' in job && job.kind === 'runtime')) {
      job.phase = UpdatePhase.Completed
      finishUpdateProgress(job)
      await FileHelper.writeAtomicJSON(this.statePath, job)
      this.latest = null
    }

    return { check: this.latest, state: job ? {
      id: job.id, phase: job.phase, version: job.version, error: job.error, progress: job.progress ?? null, steps: job.steps ?? []
    } : null }
  }

  /**
   * Coalesces manual and scheduled checks against published release metadata.
   * Development installations include prereleases; stable installations do not.
   */
  public check(): Promise<UpdateCheck> {
    this.checking ??= this.findRelease().finally(() => {
      this.checking = null
    })

    return this.checking
  }

  private async findRelease(): Promise<UpdateCheck> {
    const currentVersion = await this.version()
    if (!semver.valid(currentVersion)) {
      throw new Error('I could not determine my installed version.')
    }
    // Prerelease installs must keep receiving previews after their first update.
    const development = Boolean(semver.prerelease(currentVersion)) || currentVersion.includes('+dev')
    const candidates = (await this.releases(development)).filter((release) => !release.draft
      && typeof release.tag_name === 'string' && semver.valid(release.tag_name)
      && (development || !release.prerelease && !semver.prerelease(release.tag_name))
      && semver.gt(release.tag_name, currentVersion))
      .sort((left, right) => semver.gt(left.tag_name, right.tag_name) ? -1 : 1)
    const release = candidates[0]
    if (release && !Number.isFinite(Date.parse(release.published_at))) {
      throw new Error('The published release information is incomplete. Please try again later.')
    }
    let reason = this.managed ? null : 'I need to be started with pnpm start before I can install updates.'
    this.runtimeAsset = null
    if (this.runtimeHome) {
      try {
        const current = await currentRuntime(this.runtimeHome)
        if (await fs.realpath(current.root) !== await fs.realpath(this.root)) {
          reason = 'I can update only my active managed runtime.'
        }
        if (release) {
          const payload = await this.runtimeAssets(release.tag_name)
          this.runtimeAsset = selectRuntimeAsset(payload.manifest, release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name, undefined, payload.baseURL)
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : 'I could not verify the runtime release.'
      }
    } else {
      try {
        const top = await fs.realpath(await this.git('rev-parse', '--show-toplevel'))
        if (top !== await fs.realpath(this.root)) {
          reason = 'I can only update an installation at its Git repository root.'
        }
        if (await this.git('status', '--porcelain')) {
          reason = 'I need your local changes committed or moved aside before I can update this checkout.'
        }
      } catch {
        reason = 'I can install updates in Git-clone installations.'
      }
    }
    this.latest = {
      currentVersion, channel: development ? 'development' : 'stable',
      canInstall: reason === null, reason,
      release: release ? {
        tag: release.tag_name, version: semver.valid(release.tag_name)!,
        title: release.name || release.tag_name, publishedAt: release.published_at,
        markdown: (release.body ?? '').slice(0, MAXIMUM_RELEASE_NOTES), url: release.html_url,
        ...parseReleaseNotes((release.body ?? '').slice(0, MAXIMUM_RELEASE_NOTES))
      } : null
    }

    return this.latest
  }

  /**
   * Waits for staging before the host stops Core. Git jobs need no preparation
   * while running because their installer is owned by the managed launcher.
   */
  public async waitUntilPrepared(): Promise<void> {
    await this.preparation
  }

  /**
   * Pins an owner-reviewed release and acknowledges its host-owned job. Prebuilt
   * payloads stage asynchronously while the current Core keeps serving clients.
   */
  public async prepare(tag: string): Promise<UpdateSnapshot> {
    if (this.applying) {
      throw new Error('I’m already preparing an update.')
    }
    this.applying = true
    try {
      const previous = await this.job()
      if (previous && [UpdatePhase.Scheduled, UpdatePhase.Installing, UpdatePhase.Restarting].some((phase) => phase === previous.phase)) {
        throw new Error('I’m already updating.')
      }
      const release = this.latest?.release
      if (!release || release.tag !== tag) {
        throw new Error('Check for updates again before installing this release.')
      }
      const reviewedAsset = this.runtimeAsset
      const check = await this.check()
      if (!check.canInstall || check.release?.tag !== tag) {
        throw new Error(check.reason ?? 'The available release changed. Check for updates again.')
      }
      if (this.runtimeHome) {
        const installation = this.runtimeHome
        const asset = this.runtimeAsset
        if (!asset || !reviewedAsset || asset.sha256 !== reviewedAsset.sha256 || asset.bytes !== reviewedAsset.bytes ||
          asset.url !== reviewedAsset.url) {
          throw new Error('The runtime payload changed. Check for updates again before installing.')
        }
        const job: RuntimeUpdateJob = {
          id: randomUUID(), kind: 'runtime', phase: UpdatePhase.Scheduled, version: asset.version, error: null,
          root: this.root, installation: this.runtimeHome, expectedVersion: check.currentVersion,
          asset, profile: getActiveProfileName()
        }
        recordUpdateProgress(job, 'downloading')
        await FileHelper.writeAtomicJSON(this.statePath, job)
        // Acknowledgement is independent of download duration. Core stays
        // available until the accepted job finishes staging and clients can
        // observe failures through the ordinary status endpoint.
        const accepted = await this.snapshot()
        this.preparation = (async (): Promise<void> => {
          let lastProgress = 0
          let writing = Promise.resolve()
          let writeError: unknown
          try {
            await installRuntimeArchive({ installation, asset,
              download: FileDownloader.downloadFile.bind(FileDownloader),
              onStage: async (stage): Promise<void> => {
                await writing
                recordUpdateProgress(job, stage)
                await FileHelper.writeAtomicJSON(this.statePath, job)
              },
              onProgress: (progress): void => {
                if (Date.now() - lastProgress < 250 && progress.downloadedBytes !== progress.totalBytes) {
                  return
                }
                lastProgress = Date.now()
                recordUpdateProgress(job, 'downloading', progress)
                const snapshot = structuredClone(job)
                writing = writing.then(() => FileHelper.writeAtomicJSON(this.statePath, snapshot)).catch((error: unknown) => {
                  writeError = error
                })
              }
            })
            await writing
            if (writeError) {
              throw writeError
            }
            job.progress = null
            await FileHelper.writeAtomicJSON(this.statePath, job)
          } catch (error) {
            await writing
            job.phase = UpdatePhase.Failed
            finishUpdateProgress(job)
            job.error = error instanceof Error ? error.message : String(error)
            await FileHelper.writeAtomicJSON(this.statePath, job)
            throw error
          }
        })()
        // HTTP delivery can fail before a caller awaits preparation; retain the
        // rejection for the host without creating an unhandled promise.
        void this.preparation.catch(() => {
          this.applying = false
        })
        return accepted
      }
      await this.git('check-ref-format', `refs/tags/${tag}`)
      const expectedHead = await this.git('rev-parse', 'HEAD')
      await this.git('fetch', '--no-tags', this.repository, `refs/tags/${tag}`)
      const revision = await this.git('rev-parse', 'FETCH_HEAD^{commit}')
      try {
        await this.git('merge-base', '--is-ancestor', expectedHead, revision)
      } catch {
        throw new Error('This release cannot fast-forward your checkout. I have kept your local commits.')
      }
      const target = JSON.parse(await this.git('show', `${revision}:package.json`)) as { version: string }
      if (!semver.valid(target.version) || !semver.eq(target.version, release.version)) {
        throw new Error('The release version does not match its source. I have not changed your checkout.')
      }
      const job: UpdateJob = {
        id: randomUUID(), phase: UpdatePhase.Scheduled, version: release.version, error: null,
        root: this.root, expectedHead, revision, pnpm: RuntimeHelper.getPNPMBinPath(), profile: getActiveProfileName()
      }
      await FileHelper.writeAtomicJSON(this.statePath, job)

      return this.snapshot()
    } catch (error) {
      this.applying = false
      throw error
    }
  }
}

export const UPDATE_SERVICE = new UpdateService()
