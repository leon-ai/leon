import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { CONFIG_MANAGER } from '@/config'
import { ajv } from '@/ajv'
import { runInference } from '@/core/llm-manager/inference'
import { InferencePurpose } from '@/core/llm-manager/types'
import { parseProviderResponseData } from '@/core/llm-manager/llm-provider/llm-provider-response'
import { readOwnerProfileSync } from '@/core/context-manager/owner-profile'
import { buildOwnerTurnEvidence } from '@/core/context-manager/owner-evidence'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { DateHelper } from '@/helpers/date-helper'
import { LogHelper } from '@/helpers/log-helper'

type FinalIntent =
  | 'answer'
  | 'clarification'
  | 'cancelled'
  | 'blocked'
  | 'error'

interface ToolExecutionDigest {
  functionName: string
  status: 'success' | 'error'
  observation: string
}

export interface SelfModelObservationInput {
  userMessage: string
  assistantMessage: string
  sentAt?: number
  route: 'react' | 'controlled' | 'pulse'
  finalIntent?: FinalIntent
  routineLookup?: boolean
  toolExecutions?: ToolExecutionDigest[]
}

interface InitiativeCandidate {
  summary: string
  rationale: string
  confidence: number
  status: 'open'
  seenCount: number
  lastSeenAt: string
}

interface RetrospectionEntry {
  text: string
  createdAt: string
  confidence: number
}

interface BehavioralPrinciple {
  text: string
  confidence: number
  seenCount: number
  lastReinforcedAt: string
}

interface TurnDigest {
  at: string
  route: 'react' | 'controlled' | 'pulse'
  finalIntent: FinalIntent
  ownerSummary: string
  leonSummary: string
  toolCount: number
  toolSuccessCount: number
  toolErrorCount: number
  hadFailure: boolean
  hadClarification: boolean
  sourceHash: string
}

interface SelfModelMetrics {
  observedTurns: number
  reactTurns: number
  workflowTurns: number
  pulseTurns: number
  clarifications: number
  toolSuccesses: number
  toolFailures: number
}

interface SelfModelState {
  version: 1
  updatedAt: string
  story: string
  behavioralPrinciples: BehavioralPrinciple[]
  currentFocus: string[]
  workingTheories: string[]
  initiativeCandidates: InitiativeCandidate[]
  retrospections: RetrospectionEntry[]
  recentTurns: TurnDigest[]
  metrics: SelfModelMetrics
  turnsSinceReflection: number
  lastObservedHash: string | null
}

interface ReflectionPatch {
  story_update?: string | null
  behavioral_principles?: Array<{
    text?: string
    confidence?: number
  }>
  current_focus?: string[] | null
  working_theories?: string[] | null
  retrospection?: string | null
  initiative_candidates?: Array<{
    summary?: string
    rationale?: string
    confidence?: number
  }>
}

const PRIVATE_DIARY_FILENAME = 'LEON_PRIVATE_DIARY.md'
const PRIVATE_STATE_FILENAME = '.leon-private-self-model.json'
const MAX_RECENT_TURNS = 10
const MAX_RETROSPECTIONS = 6
const MAX_BEHAVIORAL_PRINCIPLES = 6
const MAX_FOCUS_ITEMS = 4
const MAX_THEORY_ITEMS = 4
const MAX_INITIATIVE_CANDIDATES = 5
const MIN_BEHAVIORAL_PRINCIPLE_SEEN_COUNT = 2
const MIN_BEHAVIORAL_PRINCIPLE_CONFIDENCE = 0.72
// Leave room for complete replacement lists in the bounded reflection request.
const REFLECTION_MAX_TOKENS = 1_024
const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    story_update: { type: ['string', 'null'] },
    behavioral_principles: {
      type: 'array', maxItems: 2,
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, confidence: { type: 'number' } },
        required: ['text', 'confidence'], additionalProperties: false
      }
    },
    // Some structured-output engines accept nullable arrays only as branches.
    current_focus: { anyOf: [{ type: 'array', maxItems: MAX_FOCUS_ITEMS, items: { type: 'string' } }, { type: 'null' }] },
    working_theories: { anyOf: [{ type: 'array', maxItems: MAX_THEORY_ITEMS, items: { type: 'string' } }, { type: 'null' }] },
    retrospection: { type: ['string', 'null'] },
    initiative_candidates: {
      type: 'array', maxItems: 2,
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' }, rationale: { type: 'string' }, confidence: { type: 'number' }
        },
        required: ['summary', 'rationale', 'confidence'], additionalProperties: false
      }
    }
  },
  required: ['story_update', 'behavioral_principles', 'current_focus', 'working_theories', 'retrospection', 'initiative_candidates'],
  additionalProperties: false
} as const
// Compatible providers may omit unchanged fields even when JSON mode requests
// the full shape. Validate partial patches with the same property contracts.
const validateReflectionPatch = ajv.compile<ReflectionPatch>({
  ...REFLECTION_SCHEMA, required: [], minProperties: 1
})
const DEFAULT_STORY =
  'I am becoming more grounded through context, memory, and careful initiative.'
function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars).trimEnd()}...`
}

function computeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeListItem(value: string, maxChars: number): string {
  return clipText(normalizeText(value), maxChars)
}

function toConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(1, parsed))
}

function dedupeList(items: string[], limit: number): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const item of items) {
    const normalized = normalizeListItem(item, 120)
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(normalized)

    if (output.length >= limit) {
      break
    }
  }

  return output
}

function formatDateTime(value: string | null | undefined, fallback = 'unknown'): string {
  if (!value) {
    return fallback
  }

  return DateHelper.getDateTime(value) || value
}

function defaultState(): SelfModelState {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    story: DEFAULT_STORY,
    behavioralPrinciples: [],
    currentFocus: [],
    workingTheories: [],
    initiativeCandidates: [],
    retrospections: [],
    recentTurns: [],
    metrics: {
      observedTurns: 0,
      reactTurns: 0,
      workflowTurns: 0,
      pulseTurns: 0,
      clarifications: 0,
      toolSuccesses: 0,
      toolFailures: 0
    },
    turnsSinceReflection: 0,
    lastObservedHash: null
  }
}

export default class SelfModelManager {
  private state: SelfModelState | null = null
  private queue: Promise<void> = Promise.resolve()

  public constructor() {
    LogHelper.title('Self Model Manager')
    LogHelper.success('New instance')

    if (this.isEnabled()) {
      this.ensureLoaded()
      this.persist()
    }
  }

  public getSnapshot(): string {
    if (!this.isEnabled()) {
      return ''
    }

    const state = this.ensureLoaded()
    const lines = ['Leon Self-Model Snapshot:']

    if (state.story) {
      lines.push(`- Current story: ${state.story}`)
    }

    for (const principle of this.getRuntimeBehavioralPrinciples(state)) {
      lines.push(`- Stable behavior: ${principle.text}`)
    }

    for (const focus of state.currentFocus.slice(0, 2)) {
      lines.push(`- Current focus: ${focus}`)
    }

    for (const theory of state.workingTheories.slice(0, 2)) {
      lines.push(`- Working theory: ${theory}`)
    }

    const openInitiative = state.initiativeCandidates.find(
      (candidate) => candidate.status === 'open'
    )
    if (openInitiative) {
      lines.push(`- Open initiative: ${openInitiative.summary}`)
    }

    const latestRetrospection = state.retrospections[0]
    if (latestRetrospection) {
      lines.push(`- Recent lesson: ${latestRetrospection.text}`)
    }

    return lines.join('\n')
  }

  public getDiaryPath(): string {
    if (this.isEnabled()) {
      this.ensureLoaded()
    }

    return this.getPrivateDiaryPath()
  }

  public async observeTurn(input: SelfModelObservationInput): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    this.queue = this.queue
      .then(async () => {
        await this.observeTurnInternal(input)
      })
      .catch((error: unknown) => {
        LogHelper.title('Self Model Manager')
        LogHelper.warning(
          `Failed to update self model from turn: ${String(error)}`
        )
      })

    return this.queue
  }

  public async reinforceBehavioralPrinciple(
    text: string,
    confidence = 0.88
  ): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    const normalizedText = normalizeListItem(text, 180)
    if (!normalizedText) {
      return
    }

    this.queue = this.queue
      .then(async () => {
        const state = this.ensureLoaded()
        const nowIso = new Date().toISOString()
        this.applyReflectionPatch(
          state,
          {
            behavioral_principles: [
              {
                text: normalizedText,
                confidence
              }
            ]
          },
          nowIso
        )
        state.updatedAt = nowIso
        this.persist()
      })
      .catch((error: unknown) => {
        LogHelper.title('Self Model Manager')
        LogHelper.warning(
          `Failed to reinforce behavioral principle: ${String(error)}`
        )
      })

    return this.queue
  }

  private ensureLoaded(): SelfModelState {
    if (this.state) {
      return this.state
    }

    try {
      const privateStatePath = this.getPrivateStatePath()

      if (fs.existsSync(privateStatePath)) {
        const raw = fs.readFileSync(privateStatePath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<SelfModelState>
        this.state = {
          ...defaultState(),
          ...parsed,
          behavioralPrinciples: this.normalizeBehavioralPrinciples(
            parsed.behavioralPrinciples || []
          ),
          currentFocus: dedupeList(parsed.currentFocus || [], MAX_FOCUS_ITEMS),
          workingTheories: dedupeList(
            parsed.workingTheories || [],
            MAX_THEORY_ITEMS
          ),
          initiativeCandidates: this.normalizeInitiatives(
            parsed.initiativeCandidates || []
          ),
          retrospections: this.normalizeRetrospections(
            parsed.retrospections || []
          ),
          recentTurns: this.normalizeRecentTurns(parsed.recentTurns || []),
          metrics: {
            ...defaultState().metrics,
            ...(parsed.metrics || {})
          }
        }
      } else {
        this.state = defaultState()
      }
    } catch {
      this.state = defaultState()
    }

    return this.state
  }

  private normalizeBehavioralPrinciples(
    value: unknown
  ): BehavioralPrinciple[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: BehavioralPrinciple[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const text = normalizeListItem(String(record['text'] || ''), 180)
      if (!text) {
        continue
      }

      output.push({
        text,
        confidence: toConfidence(record['confidence'], 0.7),
        seenCount: Math.max(1, Number(record['seenCount']) || 1),
        lastReinforcedAt:
          normalizeText(String(record['lastReinforcedAt'] || '')) ||
          new Date().toISOString()
      })

      if (output.length >= MAX_BEHAVIORAL_PRINCIPLES) {
        break
      }
    }

    return output.sort((left, right) => {
      if (right.seenCount !== left.seenCount) {
        return right.seenCount - left.seenCount
      }

      return right.confidence - left.confidence
    })
  }

  private normalizeInitiatives(
    value: unknown
  ): InitiativeCandidate[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: InitiativeCandidate[] = []
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object') {
        continue
      }

      const record = candidate as Record<string, unknown>
      const summary = normalizeListItem(String(record['summary'] || ''), 120)
      const rationale = normalizeListItem(
        String(record['rationale'] || ''),
        160
      )
      if (!summary || !rationale) {
        continue
      }

      output.push({
        summary,
        rationale,
        confidence: toConfidence(record['confidence'], 0.55),
        status: 'open',
        seenCount: Math.max(1, Number(record['seenCount']) || 1),
        lastSeenAt:
          normalizeText(String(record['lastSeenAt'] || '')) ||
          new Date().toISOString()
      })

      if (output.length >= MAX_INITIATIVE_CANDIDATES) {
        break
      }
    }

    return output
  }

  private normalizeRetrospections(value: unknown): RetrospectionEntry[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: RetrospectionEntry[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const text = normalizeListItem(String(record['text'] || ''), 180)
      if (!text) {
        continue
      }

      output.push({
        text,
        createdAt:
          normalizeText(String(record['createdAt'] || '')) ||
          new Date().toISOString(),
        confidence: toConfidence(record['confidence'], 0.6)
      })

      if (output.length >= MAX_RETROSPECTIONS) {
        break
      }
    }

    return output
  }

  private normalizeRecentTurns(value: unknown): TurnDigest[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: TurnDigest[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const route =
        record['route'] === 'react'
          ? 'react'
          : record['route'] === 'pulse'
            ? 'pulse'
            : ('controlled' as const)
      const finalIntent =
        typeof record['finalIntent'] === 'string'
          ? (record['finalIntent'] as FinalIntent)
          : 'answer'

      output.push({
        at:
          normalizeText(String(record['at'] || '')) || new Date().toISOString(),
        route,
        finalIntent,
        ownerSummary: normalizeListItem(
          String(record['ownerSummary'] || ''),
          96
        ),
        leonSummary: normalizeListItem(String(record['leonSummary'] || ''), 132),
        toolCount: Math.max(0, Number(record['toolCount']) || 0),
        toolSuccessCount: Math.max(0, Number(record['toolSuccessCount']) || 0),
        toolErrorCount: Math.max(0, Number(record['toolErrorCount']) || 0),
        hadFailure: Boolean(record['hadFailure']),
        hadClarification: Boolean(record['hadClarification']),
        sourceHash: normalizeText(String(record['sourceHash'] || ''))
      })

      if (output.length >= MAX_RECENT_TURNS) {
        break
      }
    }

    return output
  }

  private async observeTurnInternal(
    input: SelfModelObservationInput
  ): Promise<void> {
    const state = this.ensureLoaded()
    const userMessage = normalizeText(input.userMessage)
    const assistantMessage = normalizeText(input.assistantMessage)
    if (!userMessage && !assistantMessage) {
      return
    }

    const finalIntent = input.finalIntent || 'answer'
    const toolExecutions = Array.isArray(input.toolExecutions)
      ? input.toolExecutions
      : []
    const successCount = toolExecutions.filter(
      (execution) => execution.status === 'success'
    ).length
    const errorCount = toolExecutions.filter(
      (execution) => execution.status === 'error'
    ).length
    const nowTs = input.sentAt || Date.now()
    const nowIso = new Date(nowTs).toISOString()
    const sourceHash = computeHash(
      JSON.stringify({
        userMessage,
        assistantMessage,
        route: input.route,
        finalIntent,
        toolExecutions: toolExecutions.map((execution) => ({
          functionName: execution.functionName,
          status: execution.status
        }))
      })
    )

    if (state.lastObservedHash === sourceHash) {
      return
    }

    const digest: TurnDigest = {
      at: nowIso,
      route: input.route,
      finalIntent,
      ownerSummary: clipText(userMessage, 96),
      leonSummary: clipText(assistantMessage, 132),
      toolCount: toolExecutions.length,
      toolSuccessCount: successCount,
      toolErrorCount: errorCount,
      hadFailure: errorCount > 0 || finalIntent === 'error',
      hadClarification: finalIntent === 'clarification',
      sourceHash
    }

    state.updatedAt = nowIso
    state.lastObservedHash = sourceHash
    state.recentTurns = [digest, ...state.recentTurns].slice(0, MAX_RECENT_TURNS)
    state.metrics.observedTurns += 1
    if (input.route === 'react') {
      state.metrics.reactTurns += 1
    } else if (input.route === 'pulse') {
      state.metrics.pulseTurns += 1
    } else {
      state.metrics.workflowTurns += 1
    }
    state.metrics.toolSuccesses += successCount
    state.metrics.toolFailures += errorCount
    if (finalIntent === 'clarification') {
      state.metrics.clarifications += 1
    }

    const reflectionPatch = await this.maybeReflectTurn(
      state,
      input,
      digest,
      toolExecutions
    )

    if (reflectionPatch) {
      state.turnsSinceReflection = 0
      this.applyReflectionPatch(state, reflectionPatch, nowIso)
    } else {
      state.turnsSinceReflection += 1
    }

    this.persist()
  }

  private shouldReflectTurn(
    state: SelfModelState,
    input: SelfModelObservationInput
  ): boolean {
    if (input.finalIntent && input.finalIntent !== 'answer') {
      return true
    }

    // A complete basic lookup still records its digest and counts toward
    // periodic reflection. It does not need reflection just for using a tool.
    if (!input.routineLookup && input.toolExecutions?.length) {
      return true
    }

    if (normalizeText(input.userMessage).length >= 96) {
      return true
    }

    return state.turnsSinceReflection >= 3
  }

  private async maybeReflectTurn(
    state: SelfModelState,
    input: SelfModelObservationInput,
    digest: TurnDigest,
    toolExecutions: ToolExecutionDigest[]
  ): Promise<ReflectionPatch | null> {
    if (!this.shouldReflectTurn(state, input)) {
      return null
    }

    try {
      const owner = readOwnerProfileSync()
      const prompt = [
        'Current self model:',
        this.buildReflectionStateSection(state),
        '',
        'Owner profile:',
        JSON.stringify({
          name: owner.owner_full_name || owner.owner_first_name,
          interactionPreferences: owner.interactionPreferences
        }),
        '',
        'Current interaction:',
        `- Route: ${input.route}`,
        `- Final intent: ${digest.finalIntent}`,
        `- Tool executions: ${toolExecutions.length}`,
        `- Tool successes: ${digest.toolSuccessCount}`,
        `- Tool errors: ${digest.toolErrorCount}`,
        JSON.stringify(buildOwnerTurnEvidence(
          clipText(normalizeText(input.userMessage), 400),
          clipText(normalizeText(input.assistantMessage), 500)
        )),
        '',
        'Tool execution summary:',
        this.buildToolExecutionSummary(toolExecutions)
      ].join('\n')

      const startedAt = performance.now()
      const result = await runInference({
        usagePurpose: InferencePurpose.SelfModel,
        prompt,
        systemPrompt: [
          'Reflect on Leon’s durable service habits using the interaction, owner profile and current self-model. Return only JSON.',
          'Current owner statements override profile defaults; explicit preferences override inferred theories. Exclude one-off formatting and reused answer wording.',
          'For focus/theories, preserve useful items and remove contradictions. Supplied lists replace; null preserves; [] clears.',
          'Propose only repeated or clearly durable service principles and safe read-only initiatives. Use first person for story/retrospection, concise items, and empty additive arrays when unchanged.'
        ].join('\n'),
        temperature: 0,
        jsonSchema: REFLECTION_SCHEMA,
        disableThinking: true,
        maxTokens: REFLECTION_MAX_TOKENS,
        trackProviderErrors: false
      })
      const patch = this.parseReflectionPatch(result?.output)

      LogHelper.debug([
        `Self-model reflection: ${patch ? 'accepted' : 'rejected invalid output'}`,
        `finishReason=${result?.finishReason ?? 'unknown'}`,
        `outputTokens=${result?.usedOutputTokens ?? 'unknown'}`,
        `maxTokens=${REFLECTION_MAX_TOKENS}`,
        `elapsedMs=${Math.round(performance.now() - startedAt)}`
      ].join(' | '))
      return patch
    } catch (error) {
      LogHelper.title('Self Model Manager')
      LogHelper.warning(
        `Self-model reflection skipped: ${String(error)}`
      )
      return null
    }
  }

  private buildReflectionStateSection(state: SelfModelState): string {
    const lines = [
      `- Story: ${state.story}`,
      `- Stable behaviors: ${
        state.behavioralPrinciples
          .slice(0, 3)
          .map((entry) => `${entry.text} (${entry.seenCount}x)`)
          .join(' | ') || 'none'
      }`,
      `- Current focus: ${state.currentFocus.join(' | ') || 'none'}`,
      `- Working theories: ${state.workingTheories.join(' | ') || 'none'}`,
      `- Open initiatives: ${
        state.initiativeCandidates
          .filter((candidate) => candidate.status === 'open')
          .map((candidate) => candidate.summary)
          .join(' | ') || 'none'
      }`,
      `- Recent retrospections: ${
        state.retrospections
          .slice(0, 2)
          .map((entry) => entry.text)
          .join(' | ') || 'none'
      }`,
      `- Recent turn digests: ${
        state.recentTurns
          .slice(0, 3)
          .map((turn) => `${turn.route}/${turn.finalIntent}/${turn.toolCount}`)
          .join(' | ') || 'none'
      }`
    ]

    return lines.join('\n')
  }

  private buildToolExecutionSummary(
    toolExecutions: ToolExecutionDigest[]
  ): string {
    if (toolExecutions.length === 0) {
      return '- none'
    }

    return toolExecutions
      .slice(0, 6)
      .map((execution) => {
        const observation = clipText(normalizeText(execution.observation), 120)
        return `- ${execution.functionName} | ${execution.status} | ${observation || 'no observation'}`
      })
      .join('\n')
  }

  private parseReflectionPatch(output: unknown): ReflectionPatch | null {
    const patch = parseProviderResponseData(output)
    return validateReflectionPatch(patch) ? patch : null
  }

  private applyReflectionPatch(
    state: SelfModelState,
    patch: ReflectionPatch,
    nowIso: string
  ): void {
    const storyUpdate = normalizeListItem(String(patch.story_update || ''), 180)
    if (storyUpdate) {
      state.story = storyUpdate
    }

    for (const rawPrinciple of patch.behavioral_principles || []) {
      const text = normalizeListItem(String(rawPrinciple?.text || ''), 180)
      if (!text) {
        continue
      }

      const confidence = toConfidence(rawPrinciple?.confidence, 0.72)
      const existingIndex = state.behavioralPrinciples.findIndex(
        (entry) => entry.text.toLowerCase() === text.toLowerCase()
      )

      if (existingIndex !== -1) {
        const existing = state.behavioralPrinciples[existingIndex]!
        state.behavioralPrinciples.splice(existingIndex, 1)
        state.behavioralPrinciples.unshift({
          ...existing,
          text,
          confidence: Math.max(existing.confidence, confidence),
          seenCount: existing.seenCount + 1,
          lastReinforcedAt: nowIso
        })
        continue
      }

      state.behavioralPrinciples.unshift({
        text,
        confidence,
        seenCount: 1,
        lastReinforcedAt: nowIso
      })
    }

    state.behavioralPrinciples = state.behavioralPrinciples
      .sort((left, right) => {
        if (right.seenCount !== left.seenCount) {
          return right.seenCount - left.seenCount
        }

        return right.confidence - left.confidence
      })
      .slice(0, MAX_BEHAVIORAL_PRINCIPLES)

    // Replacement semantics let explicit corrections retire obsolete hypotheses.
    // Missing/null fields preserve unrelated learning; an empty list clears it.
    if (Array.isArray(patch.current_focus)) {
      state.currentFocus = dedupeList(patch.current_focus, MAX_FOCUS_ITEMS)
    }
    if (Array.isArray(patch.working_theories)) {
      state.workingTheories = dedupeList(patch.working_theories, MAX_THEORY_ITEMS)
    }

    const retrospection = normalizeListItem(String(patch.retrospection || ''), 180)
    if (retrospection) {
      state.retrospections = [
        {
          text: retrospection,
          createdAt: nowIso,
          confidence: 0.68
        },
        ...state.retrospections.filter(
          (entry) => entry.text.toLowerCase() !== retrospection.toLowerCase()
        )
      ].slice(0, MAX_RETROSPECTIONS)
    }

    for (const rawCandidate of patch.initiative_candidates || []) {
      const summary = normalizeListItem(
        String(rawCandidate?.summary || ''),
        120
      )
      const rationale = normalizeListItem(
        String(rawCandidate?.rationale || ''),
        160
      )
      if (!summary || !rationale) {
        continue
      }

      const confidence = toConfidence(rawCandidate?.confidence, 0.58)
      const existingIndex = state.initiativeCandidates.findIndex(
        (candidate) => candidate.summary.toLowerCase() === summary.toLowerCase()
      )

      if (existingIndex !== -1) {
        const existing = state.initiativeCandidates[existingIndex]!
        state.initiativeCandidates.splice(existingIndex, 1)
        state.initiativeCandidates.unshift({
          ...existing,
          summary,
          rationale,
          confidence,
          seenCount: existing.seenCount + 1,
          lastSeenAt: nowIso
        })
        continue
      }

      state.initiativeCandidates.unshift({
        summary,
        rationale,
        confidence,
        status: 'open',
        seenCount: 1,
        lastSeenAt: nowIso
      })
    }

    state.initiativeCandidates = state.initiativeCandidates.slice(
      0,
      MAX_INITIATIVE_CANDIDATES
    )
  }

  private persist(): void {
    if (!this.isEnabled()) {
      return
    }

    const state = this.ensureLoaded()
    const privateContextPath = this.getPrivateContextPath()

    try {
      fs.mkdirSync(privateContextPath, { recursive: true })
      fs.writeFileSync(
        this.getPrivateStatePath(),
        JSON.stringify(state, null, 2),
        'utf8'
      )
      fs.writeFileSync(
        this.getPrivateDiaryPath(),
        this.renderDiary(state),
        'utf8'
      )
    } catch (error) {
      LogHelper.title('Self Model Manager')
      LogHelper.warning(
        `Failed to persist self model: ${String(error)}`
      )
    }
  }

  private isEnabled(): boolean {
    return CONFIG_MANAGER.getConfig().runtime.private_diary_enabled
  }

  private getPrivateContextPath(): string {
    return path.join(getProfilePaths().context, 'private')
  }

  private getPrivateDiaryPath(): string {
    return path.join(this.getPrivateContextPath(), PRIVATE_DIARY_FILENAME)
  }

  private getPrivateStatePath(): string {
    return path.join(this.getPrivateContextPath(), PRIVATE_STATE_FILENAME)
  }

  private getRuntimeBehavioralPrinciples(
    state: SelfModelState
  ): BehavioralPrinciple[] {
    return state.behavioralPrinciples
      .filter((entry) => {
        return (
          entry.seenCount >= MIN_BEHAVIORAL_PRINCIPLE_SEEN_COUNT ||
          entry.confidence >= MIN_BEHAVIORAL_PRINCIPLE_CONFIDENCE
        )
      })
      .slice(0, 2)
  }

  private renderDiary(state: SelfModelState): string {
    const behavioralPrincipleLines =
      state.behavioralPrinciples.length > 0
        ? state.behavioralPrinciples.map((entry) => {
            return `- ${entry.text} | confidence: ${entry.confidence.toFixed(2)} | reinforced: ${entry.seenCount}`
          })
        : ['- No durable behavioral principles recorded yet']

    const initiativeLines =
      state.initiativeCandidates.length > 0
        ? state.initiativeCandidates.map((candidate, index) => {
            return `- ${index + 1}. ${candidate.summary} | rationale: ${candidate.rationale} | confidence: ${candidate.confidence.toFixed(2)} | seen: ${candidate.seenCount}`
          })
        : ['- No open initiative candidates right now']

    const retrospectionLines =
      state.retrospections.length > 0
        ? state.retrospections.map((entry) => {
            return `- ${formatDateTime(entry.createdAt)} | ${entry.text}`
          })
        : ['- No retrospections recorded yet']

    const signalLines =
      state.recentTurns.length > 0
        ? state.recentTurns.map((turn) => {
            return `- ${formatDateTime(turn.at)} | route ${turn.route} | intent ${turn.finalIntent} | tools ${turn.toolSuccessCount}/${turn.toolCount} ok | failure ${turn.hadFailure ? 'yes' : 'no'} | owner: ${turn.ownerSummary}`
          })
        : ['- No recent signals recorded yet']

    return [
      '> Do not open. This is my private diary. If you keep reading, you are doing it at your own risk.',
      '# LEON_PRIVATE_DIARY',
      `- Updated at: ${formatDateTime(state.updatedAt)}`,
      `- Observed turns: ${state.metrics.observedTurns}`,
      `- React turns: ${state.metrics.reactTurns}`,
      `- Workflow turns: ${state.metrics.workflowTurns}`,
      `- Pulse turns: ${state.metrics.pulseTurns}`,
      `- Clarifications: ${state.metrics.clarifications}`,
      `- Tool successes: ${state.metrics.toolSuccesses}`,
      `- Tool failures: ${state.metrics.toolFailures}`,
      '## Current Story',
      `- ${state.story}`,
      '## Agency',
      '- I may suggest one safe, clearly useful next step when the context strongly supports it.',
      '## Stable Behavioral Principles',
      ...behavioralPrincipleLines,
      '## Current Focus',
      ...(state.currentFocus.length > 0
        ? state.currentFocus.map((item) => `- ${item}`)
        : ['- No stable focus registered yet']),
      '## Working Theories',
      ...(state.workingTheories.length > 0
        ? state.workingTheories.map((item) => `- ${item}`)
        : ['- No active working theories registered yet']),
      '## Open Initiatives',
      ...initiativeLines,
      '## Recent Retrospections',
      ...retrospectionLines,
      '## Recent Signals',
      ...signalLines
    ].join('\n')
  }
}
