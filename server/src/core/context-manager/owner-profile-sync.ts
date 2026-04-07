import fs from 'node:fs'
import path from 'node:path'

import {
  buildOwnerDocument,
  getOwnerProfileLineCount,
  normalizeOwnerProfile,
  OWNER_CONTEXT_PATH,
  OWNER_PROFILE_PATH,
  parseOwnerDocument,
  readOwnerDocumentSync,
  readOwnerProfileSync,
  type OwnerProfile,
  writeOwnerProfile
} from '@/core/context-manager/owner-profile'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import { CONFIG_STATE } from '@/core/config-states/config-state'

const OWNER_DOCUMENT_TOKEN_BUDGET = 2_000
const OWNER_DOCUMENT_UPDATE_TIMEOUT_MS = 30_000
const OWNER_DOCUMENT_COMPACT_TIMEOUT_MS = 30_000
const OWNER_DOCUMENT_VERIFY_TIMEOUT_MS = 15_000
const OWNER_DOCUMENT_MAX_RETRIES = 1
const OWNER_DOCUMENT_UPDATE_MAX_TOKENS = 2_000
const OWNER_DOCUMENT_COMPACT_MAX_TOKENS = 2_000
const OWNER_DOCUMENT_VERIFY_MAX_TOKENS = 500
const OWNER_TURN_MAX_USER_CHARS = 1_200
const OWNER_TURN_MAX_ASSISTANT_CHARS = 600
const OWNER_MEMORY_ITEM_MAX_TITLE_CHARS = 120
const OWNER_MEMORY_ITEM_MAX_CONTENT_CHARS = 240

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

function parseOwnerDocumentCandidate(
  value: unknown,
  currentProfile: OwnerProfile
): OwnerProfile | null {
  if (typeof value !== 'string') {
    return null
  }

  const cleaned = stripMarkdownFences(value)
  if (!cleaned) {
    return null
  }

  const parsedProfile = parseOwnerDocument(cleaned)
  if (
    getOwnerProfileLineCount(parsedProfile) === 0 &&
    getOwnerProfileLineCount(currentProfile) > 0
  ) {
    return null
  }

  return parsedProfile
}

async function promptForOwnerDocument(
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
  timeout: number,
  data?: Record<string, unknown>
): Promise<unknown> {
  const { LLM_PROVIDER } = await import('@/core')
  const completion = await LLM_PROVIDER.prompt(prompt, {
    dutyType: LLMDuties.Inference,
    systemPrompt,
    timeout,
    maxRetries: OWNER_DOCUMENT_MAX_RETRIES,
    maxTokens,
    trackProviderErrors: false,
        /**
         * Disable thinking when Llama.cpp since local models tend
         * to loop overthink
         */
        ...(CONFIG_STATE.getModelState().getWorkflowProvider() ===
        LLMProviders.LlamaCPP
          ? { disableThinking: true }
          : {}),
    ...(data ? { data } : {})
  })

  return completion?.output
}

async function repairOwnerDocumentCandidate(
  currentDocument: string,
  candidate: string
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
    'Keep every durable owner fact from the draft unless it clearly conflicts with the current document.',
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
      OWNER_DOCUMENT_UPDATE_MAX_TOKENS,
      OWNER_DOCUMENT_UPDATE_TIMEOUT_MS
    )

    return typeof output === 'string' ? stripMarkdownFences(output) : null
  } catch {
    return null
  }
}

async function rewriteOwnerDocumentFromTurn(
  currentDocument: string,
  currentProfile: OwnerProfile,
  userMessage: string,
  assistantMessage: string,
  memoryItems: OwnerMemoryItem[]
): Promise<OwnerProfile | null> {
  const prompt = [
    'Update this OWNER.md document from the latest conversation turn.',
    'Return the full revised OWNER.md document.',
    'You may add, replace, move, merge, or delete lines.',
    'Never drop an existing durable owner fact unless the user clearly corrected it in this turn or you merged it into an equivalent clearer line.',
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
      OWNER_DOCUMENT_UPDATE_MAX_TOKENS,
      OWNER_DOCUMENT_UPDATE_TIMEOUT_MS
    )

    const parsedProfile = parseOwnerDocumentCandidate(output, currentProfile)
    if (parsedProfile) {
      return parsedProfile
    }

    if (typeof output === 'string') {
      const repaired = await repairOwnerDocumentCandidate(
        currentDocument,
        output
      )
      if (repaired) {
        return parseOwnerDocumentCandidate(repaired, currentProfile)
      }
    }
  } catch {
    return null
  }

  return null
}

async function compactOwnerDocument(
  document: string,
  currentProfile: OwnerProfile,
  missingFacts: string[] = []
): Promise<OwnerProfile | null> {
  const prompt = [
    `Compact this OWNER.md document to approximately ${OWNER_DOCUMENT_TOKEN_BUDGET} tokens or less.`,
    'Preserve every durable owner fact.',
    'You may combine, tighten, reorder, or rewrite lines, but do not weaken, omit, or contradict any durable fact.',
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

    const parsedProfile = parseOwnerDocumentCandidate(output, currentProfile)
    if (parsedProfile) {
      return parsedProfile
    }

    if (typeof output === 'string') {
      const repaired = await repairOwnerDocumentCandidate(document, output)
      if (repaired) {
        return parseOwnerDocumentCandidate(repaired, currentProfile)
      }
    }
  } catch {
    return null
  }

  return null
}

async function verifyOwnerDocumentPreservesFacts(
  previousDocument: string,
  nextDocument: string
): Promise<OwnerDocumentVerification | null> {
  const prompt = [
    'Compare the original OWNER.md and the revised OWNER.md.',
    'Decide whether every durable owner fact from the original is still preserved in the revised version.',
    'A fact is preserved if it is still present explicitly or is clearly merged into an equivalent stronger line.',
    'If anything durable was dropped, weakened, or contradicted, set safe=false and list the missing facts.',
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
      'Verify whether a revised OWNER.md still preserves every durable owner fact from the original.',
      OWNER_DOCUMENT_VERIFY_MAX_TOKENS,
      OWNER_DOCUMENT_VERIFY_TIMEOUT_MS,
      OWNER_DOCUMENT_VERIFICATION_SCHEMA
    )

    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const raw = output as Record<string, unknown>
      return {
        safe: raw['safe'] === true,
        missingFacts: Array.isArray(raw['missingFacts'])
          ? raw['missingFacts']
              .map((item) => (typeof item === 'string' ? normalizeText(item) : ''))
              .filter(Boolean)
          : []
      }
    }
  } catch {
    return null
  }

  return null
}

async function extractOwnerStaticFields(
  ownerDocument: string,
  currentProfile: OwnerProfile
): Promise<OwnerStaticFields | null> {
  const prompt = [
    'Extract only these stable owner cache fields from OWNER.md.',
    'Use null when a field is missing, unclear, inferred, or no longer current.',
    'For current company and current role, only return values that are still current now, not past employment.',
    'JSON only.',
    '',
    `Current static cache JSON: ${JSON.stringify({
      owner_first_name: currentProfile.owner_first_name,
      owner_last_name: currentProfile.owner_last_name,
      owner_full_name: currentProfile.owner_full_name,
      owner_birth_date: currentProfile.owner_birth_date,
      owner_current_city: currentProfile.owner_current_city,
      owner_current_country: currentProfile.owner_current_country,
      owner_nationality: currentProfile.owner_nationality,
      owner_current_company: currentProfile.owner_current_company,
      owner_current_role: currentProfile.owner_current_role
    })}`,
    '',
    'OWNER.md:',
    ownerDocument
  ].join('\n')

  try {
    const output = await promptForOwnerDocument(
      prompt,
      'Extract a tiny stable owner cache from OWNER.md without guessing.',
      250,
      OWNER_DOCUMENT_VERIFY_TIMEOUT_MS,
      OWNER_STATIC_FIELDS_SCHEMA
    )

    return extractOwnerStaticFieldsFromOutput(output)
  } catch {
    return null
  }
}

async function writeOwnerArtifacts(
  profile: OwnerProfile
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
    nextDocumentDraft,
    currentProfile
  )
  const nextProfile = normalizeOwnerProfile({
    ...normalizedProfile,
    ...(extractedStaticFields || {
      owner_first_name: currentProfile.owner_first_name,
      owner_last_name: currentProfile.owner_last_name,
      owner_full_name: currentProfile.owner_full_name,
      owner_birth_date: currentProfile.owner_birth_date,
      owner_current_city: currentProfile.owner_current_city,
      owner_current_country: currentProfile.owner_current_country,
      owner_nationality: currentProfile.owner_nationality,
      owner_current_company: currentProfile.owner_current_company,
      owner_current_role: currentProfile.owner_current_role
    }),
    updatedAt
  })
  const profilesEqual = areOwnerProfilesEquivalent(currentProfile, nextProfile)
  const nextDocument = buildOwnerDocument(nextProfile)
  const documentProfilesEqual = areOwnerDocumentProfilesEquivalent(
    currentDocumentProfile,
    nextProfile
  )
  const contextChanged =
    !documentProfilesEqual || !fs.existsSync(OWNER_CONTEXT_PATH)
  const profileChanged = !profilesEqual || !fs.existsSync(OWNER_PROFILE_PATH)

  if (!profileChanged && !contextChanged) {
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  if (contextChanged) {
    await fs.promises.mkdir(path.dirname(OWNER_CONTEXT_PATH), { recursive: true })
    await fs.promises.writeFile(OWNER_CONTEXT_PATH, `${nextDocument}\n`, 'utf8')
  }
  await writeOwnerProfile(nextProfile)

  return {
    profileChanged,
    contextChanged
  }
}

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
    currentProfile,
    normalizedUserMessage,
    normalizedAssistantMessage,
    memoryItems
  )

  if (!updatedProfile) {
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

  const updatedLineCount = getOwnerProfileLineCount(updatedProfile)
  const currentLineCount = getOwnerProfileLineCount(currentProfile)
  if (updatedLineCount < currentLineCount) {
    const verification = await verifyOwnerDocumentPreservesFacts(
      currentDocument,
      finalDocument
    )
    if (!verification?.safe) {
      return {
        profileChanged: false,
        contextChanged: false
      }
    }
  }

  if (estimateTokenCount(finalDocument) > OWNER_DOCUMENT_TOKEN_BUDGET) {
    const compactedProfile = await compactOwnerDocument(
      finalDocument,
      finalProfile
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
          finalProfile,
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
  }

  if (areOwnerProfilesEquivalent(currentProfile, finalProfile)) {
    return {
      profileChanged: false,
      contextChanged: false
    }
  }

  return writeOwnerArtifacts(finalProfile)
}
