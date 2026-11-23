import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { Type, type Static, type TArray, type TString } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { UPDATE_CHANGELOG_SECTIONS, type ReleaseChangeScope } from '../../bridges/runtime/contracts/updates'
import { RELEASE_ASSET_NAME } from '../../bridges/runtime/contracts/update-status.js'

export { RELEASE_ASSET_NAME } from '../../bridges/runtime/contracts/update-status.js'

const semver = createRequire(import.meta.url)('semver') as {
  valid: (value: string) => string | null
  gt: (left: string, right: string) => boolean
  major: (version: string) => number
  prerelease: (version: string) => readonly (string | number)[] | null
}
const MAXIMUM_CONTENT_BYTES = 100_000
export const RELEASE_SOURCE_NAME = 'release.json'
const versionString = Type.String({ minLength: 1, maxLength: 128 })
const desktopSchema = Type.Object({ minimumCoreVersion: versionString }, { additionalProperties: false })
const markdown = Type.String({ minLength: 1, maxLength: 8_000 })
const changes = Object.fromEntries(UPDATE_CHANGELOG_SECTIONS.map(({ id }) => [id,
  Type.Array(markdown, { maxItems: 100 })])) as Record<ReleaseChangeScope, TArray<TString>>
const releaseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  version: versionString,
  desktop: desktopSchema,
  title: Type.String({ minLength: 1, maxLength: 160 }),
  summary: markdown,
  highlights: Type.Array(Type.Object({ title: Type.String({ minLength: 1, maxLength: 160 }), body: markdown },
    { additionalProperties: false }), { maxItems: 12 }),
  changes: Type.Object(changes, { additionalProperties: false })
}, { additionalProperties: false })

export type ReleaseContent = Static<typeof releaseSchema>

export interface PublishedDistribution {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string }[]
}

/**
 * Keeps release preparation aligned with SemVer prerelease ordering.
 */
export function isPreviewVersion(version: string): boolean {
  return Boolean(semver.prerelease(version))
}

/**
 * Validates Desktop compatibility independently of release-note readiness so
 * the packaged host can use the same floor during development and distribution.
 */
export function getMinimumCoreVersion(desktop: unknown, version: string): string {
  assert(Value.Check(desktopSchema, desktop), 'release.json must specify desktop.minimumCoreVersion')
  const { minimumCoreVersion } = desktop

  assert(semver.valid(minimumCoreVersion) === minimumCoreVersion &&
    semver.major(minimumCoreVersion) === semver.major(version) && !semver.gt(minimumCoreVersion, version),
  'desktop.minimumCoreVersion must be a canonical SemVer in the release major, at or below the release version')

  return minimumCoreVersion
}

/**
 * Validates the authored payload before it can become a release description or
 * a client asset. Versions are committed in source, never stamped only in CI.
 */
export function validateReleaseContent(value: unknown, version: string, tag: string): ReleaseContent {
  assert(semver.valid(version) === version, 'Release versions must be canonical SemVer without build metadata')
  assert.equal(tag, `v${version}`, 'The release tag must match package.json')
  assert(Value.Check(releaseSchema, value), 'release.json does not match the release content schema')
  assert.equal(value.version, version, 'Release content must match package.json')
  getMinimumCoreVersion(value.desktop, version)
  assert(value.title.trim() && value.summary.trim(), 'Release title and summary must not be blank')
  assert(Buffer.byteLength(JSON.stringify(value)) <= MAXIMUM_CONTENT_BYTES, 'Release content is too large')

  return value
}

/**
 * Generates the public Markdown and app payload from one reviewed document.
 */
export function formatReleaseNotes(content: ReleaseContent): string {
  const sections = [content.summary, ...content.highlights.map(({ title, body }) => `### ${title}\n\n${body}`), '## Full changelog']
  for (const { id, label } of UPDATE_CHANGELOG_SECTIONS) {
    if (content.changes[id].length) {
      sections.push(`### ${label}\n\n${content.changes[id].map((item) => `- ${item}`).join('\n')}`)
    }
  }

  return `${sections.join('\n\n')}\n`
}

/**
 * Chooses the last OTA-capable distribution in the candidate's channel, ignoring
 * component releases. Published versions cannot be reused, including retries.
 */
export function selectPreviousDistribution(releases: PublishedDistribution[], version: string): PublishedDistribution | null {
  const preview = isPreviewVersion(version)
  const channel = releases.filter((release) => !release.draft && semver.valid(release.tag_name)
    && isPreviewVersion(release.tag_name) === preview)
  assert(channel.every((release) => semver.gt(version, release.tag_name)), 'The release must advance its published channel')

  return channel.filter((release) => release.assets.some(({ name }) => name === RELEASE_ASSET_NAME))
    .sort((left, right) => semver.gt(left.tag_name, right.tag_name) ? -1 : 1)[0] ?? null
}
