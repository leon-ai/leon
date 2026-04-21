import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_CONTEXT_PATH, SKILLS_PATH } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'

export const OWNER_CONTEXT_PATH = path.join(PROFILE_CONTEXT_PATH, 'OWNER.md')
export const OWNER_PROFILE_PATH = path.join(
  PROFILE_CONTEXT_PATH,
  '.owner-profile.json'
)
const LEGACY_OWNER_PROFILE_PATH = path.join(
  PROFILE_CONTEXT_PATH,
  'private',
  '.owner-profile.json'
)
const LEGACY_OWNER_MEMORY_PATH = path.join(
  SKILLS_PATH,
  'leon',
  'introduction',
  'memory',
  'owner.json'
)

export interface LegacyOwnerSeed {
  name: string
  birthDate: string
}

export type OwnerProfileSectionKey =
  | 'identity'
  | 'homeAndImportantPlaces'
  | 'familyAndRelationships'
  | 'background'
  | 'preferences'
  | 'workAndCareer'
  | 'interactionPreferences'
  | 'importantDates'

export interface OwnerProfile {
  updatedAt: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_full_name: string | null
  owner_birth_date: string | null
  owner_current_city: string | null
  owner_current_country: string | null
  owner_nationality: string | null
  owner_current_company: string | null
  owner_current_role: string | null
  identity: string[]
  homeAndImportantPlaces: string[]
  familyAndRelationships: string[]
  background: string[]
  preferences: string[]
  workAndCareer: string[]
  interactionPreferences: string[]
  importantDates: string[]
}

export const OWNER_PROFILE_SECTIONS: Array<{
  key: OwnerProfileSectionKey
  title: string
  emptyLine: string
}> = [
  {
    key: 'identity',
    title: 'Identity',
    emptyLine: 'No identity details recorded yet'
  },
  {
    key: 'homeAndImportantPlaces',
    title: 'Home & Important Places',
    emptyLine: 'No home or place details recorded yet'
  },
  {
    key: 'familyAndRelationships',
    title: 'Family & Relationships',
    emptyLine: 'No family or relationship details recorded yet'
  },
  {
    key: 'background',
    title: 'Background',
    emptyLine: 'No background details recorded yet'
  },
  {
    key: 'preferences',
    title: 'Preferences',
    emptyLine: 'No durable preferences recorded yet'
  },
  {
    key: 'workAndCareer',
    title: 'Work & Career',
    emptyLine: 'No work or career details recorded yet'
  },
  {
    key: 'interactionPreferences',
    title: 'Interaction Preferences',
    emptyLine: 'No interaction preferences recorded yet'
  },
  {
    key: 'importantDates',
    title: 'Important Dates',
    emptyLine: 'No important dates recorded yet'
  }
]

export const OWNER_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    owner_first_name: {
      type: ['string', 'null']
    },
    owner_last_name: {
      type: ['string', 'null']
    },
    owner_full_name: {
      type: ['string', 'null']
    },
    owner_birth_date: {
      type: ['string', 'null']
    },
    owner_current_city: {
      type: ['string', 'null']
    },
    owner_current_country: {
      type: ['string', 'null']
    },
    owner_nationality: {
      type: ['string', 'null']
    },
    owner_current_company: {
      type: ['string', 'null']
    },
    owner_current_role: {
      type: ['string', 'null']
    },
    identity: {
      type: 'array',
      items: { type: 'string' }
    },
    homeAndImportantPlaces: {
      type: 'array',
      items: { type: 'string' }
    },
    familyAndRelationships: {
      type: 'array',
      items: { type: 'string' }
    },
    background: {
      type: 'array',
      items: { type: 'string' }
    },
    preferences: {
      type: 'array',
      items: { type: 'string' }
    },
    workAndCareer: {
      type: 'array',
      items: { type: 'string' }
    },
    interactionPreferences: {
      type: 'array',
      items: { type: 'string' }
    },
    importantDates: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: [
    'owner_first_name',
    'owner_last_name',
    'owner_full_name',
    'owner_birth_date',
    'owner_current_city',
    'owner_current_country',
    'owner_nationality',
    'owner_current_company',
    'owner_current_role',
    'identity',
    'homeAndImportantPlaces',
    'familyAndRelationships',
    'background',
    'preferences',
    'workAndCareer',
    'interactionPreferences',
    'importantDates'
  ],
  additionalProperties: false
} as const

export function createEmptyOwnerProfile(): OwnerProfile {
  return {
    updatedAt: null,
    owner_first_name: null,
    owner_last_name: null,
    owner_full_name: null,
    owner_birth_date: null,
    owner_current_city: null,
    owner_current_country: null,
    owner_nationality: null,
    owner_current_company: null,
    owner_current_role: null,
    identity: [],
    homeAndImportantPlaces: [],
    familyAndRelationships: [],
    background: [],
    preferences: [],
    workAndCareer: [],
    interactionPreferences: [],
    importantDates: []
  }
}

function normalizeLine(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}

function normalizeLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const deduped = new Set<string>()
  for (const item of value) {
    const normalized = normalizeLine(item)
    if (!normalized) {
      continue
    }

    deduped.add(normalized)
  }

  return [...deduped]
}

function normalizeNullableLine(value: unknown): string | null {
  const normalized = normalizeLine(value)
  return normalized || null
}

export function normalizeOwnerProfile(value: unknown): OwnerProfile {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    updatedAt:
      typeof raw['updatedAt'] === 'string' && raw['updatedAt'].trim()
        ? raw['updatedAt'].trim()
        : null,
    owner_first_name: normalizeNullableLine(raw['owner_first_name']),
    owner_last_name: normalizeNullableLine(raw['owner_last_name']),
    owner_full_name: normalizeNullableLine(raw['owner_full_name']),
    owner_birth_date: normalizeNullableLine(raw['owner_birth_date']),
    owner_current_city: normalizeNullableLine(raw['owner_current_city']),
    owner_current_country: normalizeNullableLine(raw['owner_current_country']),
    owner_nationality: normalizeNullableLine(raw['owner_nationality']),
    owner_current_company: normalizeNullableLine(raw['owner_current_company']),
    owner_current_role: normalizeNullableLine(raw['owner_current_role']),
    identity: normalizeLines(raw['identity']),
    homeAndImportantPlaces: normalizeLines(raw['homeAndImportantPlaces']),
    familyAndRelationships: normalizeLines(raw['familyAndRelationships']),
    background: normalizeLines(raw['background']),
    preferences: normalizeLines(raw['preferences']),
    workAndCareer: normalizeLines(raw['workAndCareer']),
    interactionPreferences: normalizeLines(raw['interactionPreferences']),
    importantDates: normalizeLines(raw['importantDates'])
  }
}

function readOwnerProfileCacheSync(): OwnerProfile {
  const candidatePath = fs.existsSync(OWNER_PROFILE_PATH)
    ? OWNER_PROFILE_PATH
    : fs.existsSync(LEGACY_OWNER_PROFILE_PATH)
      ? LEGACY_OWNER_PROFILE_PATH
      : ''

  if (!candidatePath) {
    return createEmptyOwnerProfile()
  }

  try {
    const raw = fs.readFileSync(candidatePath, 'utf8')
    return normalizeOwnerProfile(JSON.parse(raw))
  } catch {
    return createEmptyOwnerProfile()
  }
}

function getSectionByTitle(title: string): {
  key: OwnerProfileSectionKey
  title: string
  emptyLine: string
} | null {
  return OWNER_PROFILE_SECTIONS.find((section) => section.title === title) || null
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars - 3).trimEnd()}...`
}

export function parseOwnerDocument(content: string): OwnerProfile {
  const profile = createEmptyOwnerProfile()
  let currentSectionKey: OwnerProfileSectionKey | null = null

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    if (line.startsWith('## ')) {
      const section = getSectionByTitle(normalizeLine(line.slice(3)))
      currentSectionKey = section?.key || null
      continue
    }

    if (!currentSectionKey || !line.startsWith('- ')) {
      continue
    }

    const section = OWNER_PROFILE_SECTIONS.find(
      (entry) => entry.key === currentSectionKey
    )
    if (!section) {
      continue
    }

    const value = normalizeLine(line.slice(2))
    if (!value || value === section.emptyLine) {
      continue
    }

    profile[currentSectionKey].push(value)
  }

  return normalizeOwnerProfile(profile)
}

export function readOwnerDocumentSync(): string {
  if (fs.existsSync(OWNER_CONTEXT_PATH)) {
    try {
      return fs.readFileSync(OWNER_CONTEXT_PATH, 'utf8')
    } catch {
      return ''
    }
  }

  return buildOwnerDocument(readOwnerProfileCacheSync())
}

export function readOwnerProfileSync(): OwnerProfile {
  const cacheProfile = readOwnerProfileCacheSync()
  const ownerDocument = readOwnerDocumentSync()
  if (ownerDocument.trim()) {
    return applyLegacyOwnerSeed(normalizeOwnerProfile({
      ...parseOwnerDocument(ownerDocument),
      owner_first_name: cacheProfile.owner_first_name,
      owner_last_name: cacheProfile.owner_last_name,
      owner_full_name: cacheProfile.owner_full_name,
      owner_birth_date: cacheProfile.owner_birth_date,
      owner_current_city: cacheProfile.owner_current_city,
      owner_current_country: cacheProfile.owner_current_country,
      owner_nationality: cacheProfile.owner_nationality,
      owner_current_company: cacheProfile.owner_current_company,
      owner_current_role: cacheProfile.owner_current_role
    }))
  }

  return applyLegacyOwnerSeed(cacheProfile)
}

export async function writeOwnerProfile(profile: OwnerProfile): Promise<void> {
  await fs.promises.mkdir(path.dirname(OWNER_PROFILE_PATH), { recursive: true })
  await fs.promises.writeFile(
    OWNER_PROFILE_PATH,
    `${JSON.stringify(normalizeOwnerProfile(profile), null, 2)}\n`,
    'utf8'
  )

  if (
    LEGACY_OWNER_PROFILE_PATH !== OWNER_PROFILE_PATH &&
    fs.existsSync(LEGACY_OWNER_PROFILE_PATH)
  ) {
    await fs.promises.rm(LEGACY_OWNER_PROFILE_PATH, { force: true })
  }
}

export function readLegacyOwnerSeedSync(): LegacyOwnerSeed | null {
  if (!fs.existsSync(LEGACY_OWNER_MEMORY_PATH)) {
    return null
  }

  try {
    const raw = JSON.parse(
      fs.readFileSync(LEGACY_OWNER_MEMORY_PATH, 'utf8')
    ) as Record<string, unknown>
    const name = normalizeLine(raw['name'])
    const birthDate = normalizeLine(raw['birth_date'])
    if (!name && !birthDate) {
      return null
    }

    return {
      name,
      birthDate
    }
  } catch {
    return null
  }
}

export function applyLegacyOwnerSeed(profile: OwnerProfile): OwnerProfile {
  const seed = readLegacyOwnerSeedSync()
  if (!seed) {
    return normalizeOwnerProfile(profile)
  }

  const identity = [...normalizeOwnerProfile(profile).identity]
  const seededLines = [
    seed.name ? `Full name: ${seed.name}` : '',
    seed.birthDate ? `Birth date: ${seed.birthDate}` : ''
  ].filter((line) => line.length > 0)

  for (const line of seededLines) {
    const separatorIndex = line.indexOf(':')
    const fieldLabel =
      separatorIndex >= 0 ? line.slice(0, separatorIndex + 1) : ''
    const hasSameField = fieldLabel
      ? identity.some((existingLine) => existingLine.startsWith(fieldLabel))
      : false

    if (!identity.includes(line) && !hasSameField) {
      identity.unshift(line)
    }
  }

  return normalizeOwnerProfile({
    ...profile,
    identity
  })
}

export function getOwnerProfileLineCount(profile: OwnerProfile): number {
  return OWNER_PROFILE_SECTIONS.reduce(
    (count, section) => count + profile[section.key].length,
    0
  )
}

export function getOwnerProfileFilledSectionCount(profile: OwnerProfile): number {
  return OWNER_PROFILE_SECTIONS.filter(
    (section) => profile[section.key].length > 0
  ).length
}

export function getOwnerProfileMissingSectionTitles(
  profile: OwnerProfile
): string[] {
  return OWNER_PROFILE_SECTIONS
    .filter((section) => profile[section.key].length === 0)
    .map((section) => section.title)
}

export function buildOwnerManifest(profile: OwnerProfile): string {
  const normalizedProfile = applyLegacyOwnerSeed(normalizeOwnerProfile(profile))
  const workHighlight =
    [...normalizedProfile.workAndCareer]
      .reverse()
      .find((line) => line.length <= 120) ||
    normalizedProfile.workAndCareer[0] ||
    ''
  const highlights = [
    ...normalizedProfile.identity.slice(0, 1),
    ...normalizedProfile.homeAndImportantPlaces.slice(0, 1),
    ...normalizedProfile.identity.slice(1, 2),
    ...(workHighlight ? [workHighlight] : []),
    ...normalizedProfile.familyAndRelationships.slice(0, 1),
    ...normalizedProfile.background.slice(0, 1),
    ...normalizedProfile.preferences.slice(0, 1)
  ].filter((line) => line.length > 0)

  if (highlights.length === 0) {
    return 'Owner profile with identity, location, birth date, work, family, preferences, and important dates.'
  }

  return clipText(
    `Owner profile with durable identity, location, birth date, work, family, preferences, and important dates. ${highlights.join('; ')}`,
    320
  )
}

export function buildOwnerDocument(profile: OwnerProfile): string {
  const normalizedProfile = applyLegacyOwnerSeed(normalizeOwnerProfile(profile))
  const filledSections = getOwnerProfileFilledSectionCount(normalizedProfile)
  const missingSections = getOwnerProfileMissingSectionTitles(normalizedProfile)
  const manifest = buildOwnerManifest(normalizedProfile)

  const sectionBlocks = OWNER_PROFILE_SECTIONS.flatMap((section) => {
    const lines = normalizedProfile[section.key]
    return [
      `## ${section.title}`,
      ...(lines.length > 0
        ? lines.map((line) => `- ${line}`)
        : [`- ${section.emptyLine}`])
    ]
  })

  const toLearnLines =
    missingSections.length > 0
      ? missingSections.map((title) => `- ${title}`)
      : ['- No major owner profile gaps queued right now']

  return [
    `> ${manifest}`,
    '# OWNER',
    `- Profile updated at: ${DateHelper.getDateTime(normalizedProfile.updatedAt || '') || 'unknown'}`,
    `- Filled sections: ${filledSections}/${OWNER_PROFILE_SECTIONS.length}`,
    ...sectionBlocks,
    '## To Learn',
    ...toLearnLines
  ].join('\n')
}
