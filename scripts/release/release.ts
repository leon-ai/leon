import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { RELEASE_SOURCE_NAME, selectPreviousDistribution, validateReleaseContent,
  type PublishedDistribution } from './release-content'

const execute = promisify(execFile)
const COMMAND_TIMEOUT_MS = 60_000
const TAG_PREFIX = 'refs/tags/'
const CORE_TAG_PREFIX = `${TAG_PREFIX}v`
const MAXIMUM_RELEASE_RESPONSE_BYTES = 16 * 1_024 * 1_024
const semver = createRequire(import.meta.url)('semver') as {
  valid: (value: string) => string | null
  parse: (value: string) => { build: string[] } | null
  prerelease: (value: string) => readonly (string | number)[] | null
  gt: (left: string, right: string) => boolean
  rcompare: (left: string, right: string) => number
}

/**
 * Prepares reviewed release content, then pushes one immutable version tag from
 * a clean, already-pushed commit. GitHub's release gates own all publication.
 */
export async function release({ root = process.cwd(), dryRun = false } = {}): Promise<void> {
  const run = async (command: string, args: string[]): Promise<string> =>
    (await execute(command, args, { cwd: root, timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 16 * 1_024 * 1_024, windowsHide: true })).stdout.trim()
  const git = (...args: string[]): Promise<string> => run('git', args)
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const version = manifest.version
  assert(semver.valid(version) === version && !semver.parse(version)?.build.length,
    'Set package.json to a canonical release version without build metadata.')

  const remote = await git('config', '--get', 'remote.origin.url')
  // Read the configured identity before Git applies local transport rewrites.
  const ssh = 'git@github.com:'
  const repositoryURL = new URL(remote.startsWith(ssh) ? `https://github.com/${remote.slice(ssh.length)}` : remote)
  assert.equal(repositoryURL.hostname, 'github.com', 'The origin remote must identify the GitHub release repository.')
  const segments = repositoryURL.pathname.split('/').filter(Boolean)
  assert.equal(segments.length, 2, 'The origin remote must identify one GitHub repository.')
  const name = segments[1]!
  segments[1] = name.endsWith('.git') ? name.slice(0, -4) : name
  const repository = { nameWithOwner: segments.join('/'), url: `https://github.com/${segments.join('/')}` }
  const api = new URL(process.env['GITHUB_API_URL'] ?? 'https://api.github.com')
  const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN']
  const published: PublishedDistribution[] = []
  let next: URL | null = new URL(`/repos/${repository.nameWithOwner}/releases?per_page=100`, api)
  while (next) {
    assert.equal(next.origin, api.origin, 'Release pagination must remain on the GitHub API host.')
    const response: Response = await fetch(next, { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS), headers: {
      Accept: 'application/vnd.github+json', 'User-Agent': 'Leon-release', ...(token ? { Authorization: `Bearer ${token}` } : {})
    } })
    assert(response.ok, `Could not check published releases (${response.status}). No release tag was pushed.`)
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of response.body!) {
      bytes += chunk.length
      assert(bytes <= MAXIMUM_RELEASE_RESPONSE_BYTES, 'The release API response exceeds its size limit.')
      chunks.push(chunk)
    }
    const page: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert(Array.isArray(page), 'The release API returned incomplete metadata.')
    published.push(...page as PublishedDistribution[])
    const link = response.headers.get('link')?.split(',').map((value) => value.trim().split(';').map((part) => part.trim()))
      .find((parts) => parts[1] === 'rel="next"')?.[0]
    next = link ? new URL(link.slice(1, -1), api) : null
  }
  const refs = (await git('ls-remote', '--tags', 'origin')).split('\n')
    .map((line) => line.split('\t')[1]).filter((ref): ref is string => Boolean(ref))
  const tags = refs.filter((ref) => ref.startsWith(CORE_TAG_PREFIX) && !ref.endsWith('^{}'))
    .map((ref) => ref.slice(TAG_PREFIX.length)).filter((tag) => semver.valid(tag))
  const tag = `v${version}`
  assert(!refs.includes(`${TAG_PREFIX}${tag}`), `${tag} already exists upstream. Check its Actions run; do not reuse published tags.`)
  // Pushed tags count as used versions even if their release gates failed.
  selectPreviousDistribution([...published, ...tags.map((tag_name) => ({
    tag_name, draft: false, prerelease: Boolean(semver.prerelease(tag_name)), assets: []
  }))], version)
  const stable = published.filter((item) => !item.draft && semver.valid(item.tag_name) && !semver.prerelease(item.tag_name))
    .sort((left, right) => semver.rcompare(left.tag_name, right.tag_name))[0]
  assert(!stable || semver.gt(version, stable.tag_name), 'The new version must advance the latest stable release too.')

  const filename = path.join(root, RELEASE_SOURCE_NAME)
  let content = await fs.readFile(filename, 'utf8').then(JSON.parse).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }

    return null
  })
  if (!content || content.version !== version) {
    if (dryRun) {
      console.log(`Would prepare ${RELEASE_SOURCE_NAME} for ${version}; review and commit the release content before tagging.`)
      return
    }
    content = content ? { ...content, version } : {
      schemaVersion: 1, version, desktop: { minimumServerVersion: version },
      title: `Leon ${version}`, summary: '', highlights: [],
      changes: { new: [], improvements: [], fixes: [], removed: [] }
    }
    await fs.writeFile(filename, JSON.stringify(content, null, 2) + '\n')
    console.log(`Prepared ${RELEASE_SOURCE_NAME} for ${version}. Review its summary, highlights and changes, commit and push, then run pnpm release again.`)
    return
  }
  validateReleaseContent(content, version, tag)
  assert(!(await git('status', '--porcelain')), 'Commit and push the reviewed code and release.json before releasing.')
  const branch = await git('symbolic-ref', '--short', 'HEAD')
  const commit = await git('rev-parse', 'HEAD')
  const upstream = await git('ls-remote', 'origin', `refs/heads/${branch}`)
  assert.equal(upstream.split('\t')[0], commit, 'Push the current branch to origin before releasing.')
  const localTags = (await git('tag', '--list', tag)).split('\n')
  if (localTags.includes(tag)) {
    assert.equal(await git('rev-parse', `${tag}^{commit}`), commit, 'The local release tag points to another commit.')
  }

  console.log(`${dryRun ? 'Would request' : 'Requesting'} Leon ${version} from ${commit} on ${repository.nameWithOwner}.`)
  if (!dryRun) {
    if (!localTags.includes(tag)) {
      await git('tag', '-a', tag, '-m', `Leon ${version}`, commit)
    }
    await git('push', 'origin', `${TAG_PREFIX}${tag}:${TAG_PREFIX}${tag}`)
  }
  console.log(`GitHub gates build and publish Leon. Verified desktop installers join the same product release when desktop delivery is enabled.\n${repository.url}/actions/workflows/release.yml`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.slice(2).every((argument) => argument === '--dry-run'), 'Supported option: --dry-run')
  release({ dryRun: process.argv.includes('--dry-run') }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
