import fs from 'node:fs'
import path from 'node:path'

import {
  buildOwnerDocument,
  getOwnerContextPath,
  getOwnerProfilePath,
  OWNER_PROFILE_SECTIONS,
  normalizeOwnerProfile,
  parseOwnerDocument,
  readOwnerDocumentSync,
  readOwnerProfileSync,
  type OwnerProfile,
  writeOwnerProfile
} from '@/core/context-manager/owner-profile'
import { LLMDuties } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'

const OWNER_DOCUMENT_TOKEN_BUDGET = 2_000
const OWNER_DOCUMENT_UPDATE_TIMEOUT_MS = 30_000
const OWNER_DOCUMENT_COMPACT_TIMEOUT_MS = 30_000
const OWNER_DOCUMENT_VERIFY_TIMEOUT_MS = 15_000
const OWNER_DOCUMENT_MAX_RETRIES = 1
const OWNER_DOCUMENT_UPDATE_MIN_TOKENS = 4_096
const OWNER_DOCUMENT_UPDATE_MAX_TOKENS = 16_384
const OWNER_DOCUMENT_COMPACT_MAX_TOKENS = 4_096
const OWNER_DOCUMENT_VERIFY_MAX_TOKENS = 1_024
const OWNER_STATIC_FIELDS_MAX_TOKENS = 1_024
const OWNER_DOCUMENT_OUTPUT_HEADROOM = 2
const OWNER_TURN_MAX_USER_CHARS = 1_200
const OWNER_TURN_MAX_ASSISTANT_CHARS = 600
const OWNER_MEMORY_ITEM_MAX_TITLE_CHARS = 120
const OWNER_MEMORY_ITEM_MAX_CONTENT_CHARS = 240
const OWNER_PROFILE_CURATION_RULES = [
  'OWNER.md is a curated personal profile, not a transcript, task log, or machine inventory.',
  'Keep durable identity, meaningful places, relationships, background, current career, explicit lasting preferences, and important personal dates.',
  'Exclude credentials and secrets, temporary files and paths, file counts, tool output, debugging findings, vulnerability reports, market snapshots, and one-off task instructions.',
  'Remove existing out-of-scope material and duplicates instead of preserving them as owner facts.',
  'Do not turn a single task request into a lasting preference or infer personal facts from assistant text or tool output.',
  'Keep ongoing personal projects distinct from current employment.'
].join('\n')

interface OwnerTurnToolExecution {
  functionName: string
  status: 'success' | 'error'
  observation: string
}

interface OwnerMemoryItem {
  title: string | null
  content: string
}

interface OwnerDocumentVerification {
  safe: boolean
  missingFacts: string[]
}

type OwnerStaticFields = Pick<
  OwnerProfile,
  | 'owner_first_name'
  | 'owner_last_name'
  | 'owner_full_name'
  | 'owner_birth_date'
  | 'owner_current_city'
  | 'owner_current_country'
  | 'owner_nationality'
  | 'owner_current_company'
  | 'owner_current_role'
>

const OWNER_DOCUMENT_VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    safe: { type: 'boolean' },
    missingFacts: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['safe', 'missingFacts'],
  additionalProperties: false
} as const

const OWNER_STATIC_FIELDS_SCHEMA = {
  type: 'object',
  properties: {
    owner_first_name: { type: ['string', 'null'] },
    owner_last_name: { type: ['string', 'null'] },
    owner_full_name: { type: ['string', 'null'] },
    owner_birth_date: { type: ['string', 'null'] },
    owner_current_city: { type: ['string', 'null'] },
    owner_current_country: { type: ['string', 'null'] },
    owner_nationality: { type: ['string', 'null'] },
    owner_current_company: { type: ['string', 'null'] },
    owner_current_role: { type: ['string', 'null'] }
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
    'owner_current_role'
  ],
  additionalProperties: false
} as const

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxChars: number): string {
  const normalized = normalizeText(value)
  if (normalized.length <= maxChars) {
    return normalized
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`
}

function stripMarkdownFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
}

function estimateTokenCount(value: string): number {
  return Math.ceil(value.length / 4)
}

/**
 * Leave room to rewrite a large existing profile before attempting compaction.
 */
function getOwnerDocumentOutputBudget(document: string): number {
  return Math.min(OWNER_DOCUMENT_UPDATE_MAX_TOKENS, Math.max(
    OWNER_DOCUMENT_UPDATE_MIN_TOKENS,
    estimateTokenCount(document) * OWNER_DOCUMENT_OUTPUT_HEADROOM
  ))
}

function areOwnerProfilesEquivalent(
  profileA: OwnerProfile,
  profileB: OwnerProfile
): boolean {
  return JSON.stringify(normalizeOwnerProfile({
    ...profileA,
    updatedAt: null
  })) === JSON.stringify(normalizeOwnerProfile({
    ...profileB,
    updatedAt: null
  }))
}

function areOwnerDocumentProfilesEquivalent(
  profileA: OwnerProfile,
  profileB: OwnerProfile
): boolean {
  return JSON.stringify(normalizeOwnerProfile({
    ...profileA,
    updatedAt: null,
    owner_first_name: null,
    owner_last_name: null,
    owner_full_name: null,
    owner_birth_date: null,
    owner_current_city: null,
    owner_current_country: null,
    owner_nationality: null,
    owner_current_company: null,
    owner_current_role: null
  })) === JSON.stringify(normalizeOwnerProfile({
    ...profileB,
    updatedAt: null,
    owner_first_name: null,
    owner_last_name: null,
    owner_full_name: null,
    owner_birth_date: null,
    owner_current_city: null,
    owner_current_country: null,
    owner_nationality: null,
    owner_current_company: null,
    owner_current_role: null
  }))
}

function extractOwnerStaticFieldsFromOutput(output: unknown): OwnerStaticFields | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null
  }

  const raw = output as Record<string, unknown>
  if (!OWNER_STATIC_FIELDS_SCHEMA.required.every((field) =>
    raw[field] === null || typeof raw[field] === 'string'
  )) {
    return null
  }
  const normalized = normalizeOwnerProfile({
    owner_first_name: raw['owner_first_name'],
    owner_last_name: raw['owner_last_name'],
    owner_full_name: raw['owner_full_name'],
    owner_birth_date: raw['owner_birth_date'],
    owner_current_city: raw['owner_current_city'],
    owner_current_country: raw['owner_current_country'],
    owner_nationality: raw['owner_nationality'],
    owner_current_company: raw['owner_current_company'],
    owner_current_role: raw['owner_current_role']
  })

  return {
    owner_first_name: normalized.owner_first_name,
    owner_last_name: normalized.owner_last_name,
    owner_full_name: normalized.owner_full_name,
    owner_birth_date: normalized.owner_birth_date,
    owner_current_city: normalized.owner_current_city,
    owner_current_country: normalized.owner_current_country,
    owner_nationality: normalized.owner_nationality,
    owner_current_company: normalized.owner_current_company,
    owner_current_role: normalized.owner_current_role
  }
}

function extractOwnerMemoryItemsFromToolExecutions(
  toolExecutions: OwnerTurnToolExecution[] = []
): OwnerMemoryItem[] {
  const items: OwnerMemoryItem[] = []
  const seen = new Set<string>()

  for (const toolExecution of toolExecutions) {
    if (
      toolExecution.functionName !== 'structured_knowledge.memory.write' ||
      toolExecution.status !== 'success' ||
      !toolExecution.observation
    ) {
      continue
    }

    try {
      const observation = JSON.parse(toolExecution.observation) as Record<string, unknown>
      const data =
        parsedInputLike(observation['data'])
          ? (observation['data'] as Record<string, unknown>)
          : null
      const parsedInput =
        parsedInputLike(data?.['parsed_input'])
          ? (data['parsed_input'] as Record<string, unknown>)
          : null
      const inputOptions =
        parsedInputLike(parsedInput?.['options'])
          ? (parsedInput['options'] as Record<string, unknown>)
          : null
      const output =
        parsedInputLike(data?.['output'])
          ? (data['output'] as Record<string, unknown>)
          : null
      const result =
        parsedInputLike(output?.['result'])
          ? (output['result'] as Record<string, unknown>)
          : null
      const resultData =
        parsedInputLike(result?.['data'])
          ? (result['data'] as Record<string, unknown>)
          : null
      const titleCandidates = [
        inputOptions?.['title'],
        parsedInput?.['title'],
        resultData?.['title']
      ]
      const contentCandidates = [
        parsedInput?.['content'],
        resultData?.['content']
      ]
      const title = titleCandidates.find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0
      )
      const content = contentCandidates.find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0
      )

      if (!content) {
        continue
      }

      const normalizedTitle = title ? truncateText(title, OWNER_MEMORY_ITEM_MAX_TITLE_CHARS) : null
      const normalizedContent = truncateText(content, OWNER_MEMORY_ITEM_MAX_CONTENT_CHARS)
      if (!normalizedContent) {
        continue
      }

      const itemKey = `${normalizedTitle || ''}\n${normalizedContent}`
      if (seen.has(itemKey)) {
        continue
      }

      items.push({
        title: normalizedTitle,
        content: normalizedContent
      })
      seen.add(itemKey)
    } catch {
      continue
    }
  }

  return items
}

function parsedInputLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseOwnerDocumentCandidate(value: unknown): OwnerProfile | null {
  if (typeof value !== 'string') {
    return null
  }

  const cleaned = stripMarkdownFences(value)
  if (!cleaned) {
    return null
  }

  // A truncated response can contain valid bullets while missing whole sections.
  // Empty sections are valid, including when the owner explicitly removes facts.
  const headings = cleaned.split('\n').map((line) => line.trim())
    .filter((line) => line.startsWith('#'))
  const expectedHeadings = [
    '# OWNER',
    ...OWNER_PROFILE_SECTIONS.map((section) => `## ${section.title}`),
    '## To Learn'
  ]
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
    return null
  }

  return parseOwnerDocument(cleaned)
}

async function promptForOwnerDocument(
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  timeout: number,
  data?: Record<string, unknown>
): Promise<unknown> {
  const { LLM_PROVIDER } = await import('@/core')
  // Some compatible providers support JSON mode but do not enforce its schema.
  // Ground the exact field names in the prompt as well as the request metadata.
  const groundedPrompt = data
    ? `${prompt}\n\nRequired JSON schema (include every required field):\n${JSON.stringify(data)}`
    : prompt
  const completion = await LLM_PROVIDER.prompt(groundedPrompt, {
    dutyType: LLMDuties.Inference,
    systemPrompt,
    timeout,
    maxRetries: OWNER_DOCUMENT_MAX_RETRIES,
    maxTokens,
    trackProviderErrors: false,
    // These bounded editing/extraction calls need their output budget for data.
    disableThinking: true,
    ...(data ? { data } : {})
  })

  return completion?.output
}

async function repairOwnerDocumentCandidate(
  currentDocument: string,
  candidate: string,
  userMessage = ''
): Promise<string | null> {
  const prompt = [
    'Rewrite this into a valid OWNER.md document.',
    'Keep the exact top-level structure:',
    '> manifest',
    '# OWNER',
    '- Profile updated at: ...',
    '- Filled sections: ...',
    '## Identity',
    '## Home & Important Places',
    '## Family & Relationships',
    '## Background',
    '## Preferences',
    '## Work & Career',
    '## Interaction Preferences',
    '## Important Dates',
    '## To Learn',
    OWNER_PROFILE_CURATION_RULES,
    'Repair structure without undoing corrections or deletions explicitly requested by the owner.',
    `Latest owner message: ${userMessage}`,
    'No code fences. Markdown only.',
    '',
    'Current OWNER.md:',
    currentDocument,
    '',
    'Draft to repair:',
    candidate
  ].join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Repair an OWNER.md markdown document without dropping durable owner facts.',
      getOwnerDocumentOutputBudget(currentDocument),
      OWNER_DOCUMENT_UPDATE_TIMEOUT_MS
    )

    return typeof output === 'string' ? stripMarkdownFences(output) : null
  } catch {
    return null
  }
}

async function rewriteOwnerDocumentFromTurn(
  currentDocument: string,
  userMessage: string,
  assistantMessage: string,
  memoryItems: OwnerMemoryItem[]
): Promise<OwnerProfile | null> {
  const prompt = [
    'Update this OWNER.md document from the latest conversation turn.',
    'Return the full revised OWNER.md document.',
    'If neither the latest turn nor profile curation requires any change, return the current OWNER.md unchanged.',
    OWNER_PROFILE_CURATION_RULES,
    'Do not use task details, temporary instructions, transient project context, or assistant wording as owner-profile facts.',
    'You may add, replace, move, merge, or delete lines.',
    'Preserve valid in-scope facts unless the owner explicitly corrects or removes them. Merge equivalent facts and remove out-of-scope material.',
    'Keep one durable fact per bullet line.',
    'Keep the most important current fact first within each section when possible.',
    'The manifest one-liner should prioritize: full name, home/location, birth date, current work/career, then family and other durable facts.',
    'Keep the exact section structure and section order already used in OWNER.md.',
    'Keep ## To Learn aligned with major profile gaps that remain.',
    'No code fences. Markdown only.',
    '',
    'Current OWNER.md:',
    currentDocument,
    '',
    memoryItems.length > 0
      ? [
          'Successful memory.write items from this turn:',
          ...memoryItems.map(({ title, content }) =>
            title
              ? `- title: ${title} | content: ${content}`
              : `- content: ${content}`
          )
        ].join('\n')
      : '',
    'Latest turn:',
    `User: ${userMessage}`,
    assistantMessage ? `Assistant: ${assistantMessage}` : ''
  ].filter(Boolean).join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Maintain a compact durable OWNER.md profile for Leon. Edit the whole document conservatively and accurately.',
      getOwnerDocumentOutputBudget(currentDocument),
      OWNER_DOCUMENT_UPDATE_TIMEOUT_MS
    )

    const parsedProfile = parseOwnerDocumentCandidate(output)
    if (parsedProfile) {
      return parsedProfile
    }

    if (typeof output === 'string') {
      const repaired = await repairOwnerDocumentCandidate(
        currentDocument,
        output,
        userMessage
      )
      if (repaired) {
        return parseOwnerDocumentCandidate(repaired)
      }
    }
  } catch {
    return null
  }

  return null
}

async function compactOwnerDocument(
  document: string,
  missingFacts: string[] = []
): Promise<OwnerProfile | null> {
  const prompt = [
    `Compact this OWNER.md document to approximately ${OWNER_DOCUMENT_TOKEN_BUDGET} tokens or less.`,
    OWNER_PROFILE_CURATION_RULES,
    'Preserve all valid in-scope facts. Combine, tighten, reorder, or rewrite lines without weakening them.',
    'Keep the same top-level structure and section order.',
    'Keep the most important current fact first within each section when possible.',
    'The manifest one-liner should prioritize: full name, home/location, birth date, current work/career, then family and other durable facts.',
    missingFacts.length > 0
      ? `These facts were at risk in a prior compaction attempt and must still be present: ${missingFacts.join('; ')}`
      : '',
    'No code fences. Markdown only.',
    '',
    'Current OWNER.md:',
    document
  ].filter(Boolean).join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Compact OWNER.md without losing durable owner facts.',
      OWNER_DOCUMENT_COMPACT_MAX_TOKENS,
      OWNER_DOCUMENT_COMPACT_TIMEOUT_MS
    )

    const parsedProfile = parseOwnerDocumentCandidate(output)
    if (parsedProfile) {
      return parsedProfile
    }

    if (typeof output === 'string') {
      const repaired = await repairOwnerDocumentCandidate(document, output)
      if (repaired) {
        return parseOwnerDocumentCandidate(repaired)
      }
    }
  } catch {
    return null
  }

  return null
}

async function verifyOwnerDocumentPreservesFacts(
  previousDocument: string,
  nextDocument: string,
  userMessage = ''
): Promise<OwnerDocumentVerification | null> {
  const prompt = [
    'Compare the original OWNER.md and the revised OWNER.md.',
    OWNER_PROFILE_CURATION_RULES,
    'Verify that the revision preserves valid in-scope facts, applies the latest owner corrections/removals, and introduces no unsupported facts.',
    'Explicit owner corrections and removals override the original document. Do not require superseded claims or removed facts to remain.',
    'Removing out-of-scope material or duplicate facts is safe and desirable.',
    'A fact is preserved if it is still present explicitly or is clearly merged into an equivalent stronger line.',
    'Set safe=false for unexplained loss of valid facts, missed owner corrections, unsupported additions, or retained/new out-of-scope content. List the issues in missingFacts.',
    `Latest owner message: ${userMessage}`,
    'JSON only.',
    '',
    'Original OWNER.md:',
    previousDocument,
    '',
    'Revised OWNER.md:',
    nextDocument
  ].join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Verify owner profile curation and corrections against the original document and latest owner message.',
      OWNER_DOCUMENT_VERIFY_MAX_TOKENS,
      OWNER_DOCUMENT_VERIFY_TIMEOUT_MS,
      OWNER_DOCUMENT_VERIFICATION_SCHEMA
    )

    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const raw = output as Record<string, unknown>
      if (typeof raw['safe'] !== 'boolean' || !Array.isArray(raw['missingFacts']) ||
          !raw['missingFacts'].every((item) => typeof item === 'string')) {
        return null
      }
      return {
        safe: raw['safe'] === true && raw['missingFacts'].length === 0,
        missingFacts: raw['missingFacts'].map(normalizeText).filter(Boolean)
      }
    }
  } catch {
    return null
  }

  return null
}

async function extractOwnerStaticFields(
  ownerDocument: string
): Promise<OwnerStaticFields | null> {
  const prompt = [
    'Extract only these stable owner cache fields from OWNER.md.',
    'Use null when a field is missing, unclear, inferred, or no longer current.',
    'For current company and current role, only return values that are still current now, not past employment.',
    'Use the document as the only source of truth. Personal projects are not employers unless explicitly described as employment.',
    'JSON only.',
    '',
    'OWNER.md:',
    ownerDocument
  ].join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Extract a tiny stable owner cache from OWNER.md without guessing.',
      OWNER_STATIC_FIELDS_MAX_TOKENS,
      OWNER_DOCUMENT_VERIFY_TIMEOUT_MS,
      OWNER_STATIC_FIELDS_SCHEMA
    )

    return extractOwnerStaticFieldsFromOutput(output)
  } catch {
    return null
  }
}

async function writeOwnerArtifacts(
  profile: OwnerProfile,
  expectedDocument: string
): Promise<{ profileChanged: boolean, contextChanged: boolean }> {
  const currentProfile = readOwnerProfileSync()
  const normalizedProfile = normalizeOwnerProfile(profile)
  const currentDocument = readOwnerDocumentSync().trimEnd()
  const currentDocumentProfile = parseOwnerDocument(currentDocument)
  const updatedAt = new Date().toISOString()
  const nextDocumentDraft = buildOwnerDocument({
    ...normalizedProfile,
    updatedAt
  })
  const extractedStaticFields = await extractOwnerStaticFields(
    nextDocumentDraft
  )
  if (!extractedStaticFields) {
    LogHelper.error('Owner profile sync: structured extraction failed; neither artifact was updated')
    return { profileChanged: false, contextChanged: false }
  }
  // A background update must not overwrite a manual edit or another completed turn.
  if (readOwnerDocumentSync().trimEnd() !== expectedDocument.trimEnd()) {
    LogHelper.error('Owner profile sync: document changed during generation; update discarded')
    return { profileChanged: false, contextChanged: false }
  }
  const nextProfile = normalizeOwnerProfile({
    ...normalizedProfile,
    ...extractedStaticFields,
    updatedAt
  })
  const profilesEqual = areOwnerProfilesEquivalent(currentProfile, nextProfile)
  const nextDocument = buildOwnerDocument(nextProfile)
  const documentProfilesEqual = areOwnerDocumentProfilesEquivalent(
    currentDocumentProfile,
    nextProfile
  )
  const contextChanged =
    !documentProfilesEqual ||
    currentDocument.split('\n')[0] !== nextDocument.split('\n')[0] ||
    !fs.existsSync(getOwnerContextPath())
  const profileChanged = !profilesEqual || !fs.existsSync(getOwnerProfilePath())

  if (!profileChanged && !contextChanged) {
    LogHelper.debug('Owner profile sync: no changes')
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  if (contextChanged) {
    const ownerContextPath = getOwnerContextPath()

    await fs.promises.mkdir(path.dirname(ownerContextPath), { recursive: true })
    await fs.promises.writeFile(ownerContextPath, `${nextDocument}\n`, 'utf8')
  }
  await writeOwnerProfile(nextProfile)
  const { CONTEXT_MANAGER, PERSONA } = await import('@/core')
  CONTEXT_MANAGER.refreshOwnerContext()
  PERSONA.refreshContextInfo()
  LogHelper.info('Owner profile sync: OWNER.md and structured profile synchronized')

  return {
    profileChanged,
    contextChanged
  }
}

/**
 * Curate owner facts from a completed turn and publish matching profile artifacts.
 */
export async function syncOwnerProfileFromTurn(
  userMessage: string,
  assistantMessage: string,
  toolExecutions: OwnerTurnToolExecution[] = []
): Promise<{ profileChanged: boolean, contextChanged: boolean }> {
  const normalizedUserMessage = truncateText(userMessage, OWNER_TURN_MAX_USER_CHARS)
  const normalizedAssistantMessage = truncateText(
    assistantMessage,
    OWNER_TURN_MAX_ASSISTANT_CHARS
  )
  const memoryItems = extractOwnerMemoryItemsFromToolExecutions(toolExecutions)

  if (!normalizedUserMessage && memoryItems.length === 0) {
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  const currentProfile = readOwnerProfileSync()
  const currentDocument = readOwnerDocumentSync().trimEnd()
  const updatedProfile = await rewriteOwnerDocumentFromTurn(
    currentDocument,
    normalizedUserMessage,
    normalizedAssistantMessage,
    memoryItems
  )

  if (!updatedProfile) {
    LogHelper.error('Owner profile sync: rewrite/repair failed or returned an incomplete document')
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  let finalProfile = updatedProfile
  let finalDocument = buildOwnerDocument({
    ...updatedProfile,
    updatedAt: currentProfile.updatedAt
  })

  // Replacing a fact or adding unsupported content need not change the bullet count.
  if (!areOwnerDocumentProfilesEquivalent(currentProfile, updatedProfile)) {
    const verification = await verifyOwnerDocumentPreservesFacts(
      currentDocument,
      finalDocument,
      normalizedUserMessage
    )
    if (!verification?.safe) {
      // Log the failing stage, not personal facts or credentials echoed by a model.
      LogHelper.error(verification
        ? 'Owner profile sync: revision rejected by curation/correction verification'
        : 'Owner profile sync: revision verification failed or returned invalid output')
      return {
        profileChanged: false,
        contextChanged: false
      }
    }
  }

  if (estimateTokenCount(finalDocument) > OWNER_DOCUMENT_TOKEN_BUDGET) {
    const compactedProfile = await compactOwnerDocument(
      finalDocument
    )
    if (compactedProfile) {
      const compactedDocument = buildOwnerDocument({
        ...compactedProfile,
        updatedAt: currentProfile.updatedAt
      })
      let verification = await verifyOwnerDocumentPreservesFacts(
        finalDocument,
        compactedDocument
      )

      if (!verification?.safe) {
        const retriedCompaction = await compactOwnerDocument(
          finalDocument,
          verification?.missingFacts || []
        )
        if (retriedCompaction) {
          const retriedDocument = buildOwnerDocument({
            ...retriedCompaction,
            updatedAt: currentProfile.updatedAt
          })
          verification = await verifyOwnerDocumentPreservesFacts(
            finalDocument,
            retriedDocument
          )

          if (verification?.safe) {
            finalProfile = retriedCompaction
            finalDocument = retriedDocument
          }
        }
      } else {
        finalProfile = compactedProfile
        finalDocument = compactedDocument
      }
    }
    if (estimateTokenCount(finalDocument) > OWNER_DOCUMENT_TOKEN_BUDGET) {
      LogHelper.warning('Owner profile sync: compaction did not reach the target size; preserving the verified revision')
    }
  }

  if (areOwnerProfilesEquivalent(currentProfile, finalProfile)) {
    LogHelper.debug('Owner profile sync: no changes')
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  return writeOwnerArtifacts(finalProfile, currentDocument)
}
