import { randomUUID } from 'node:crypto'
import {
  isAuroraSpec, MAXIMUM_ANSWER_UI_CHARACTERS, MAXIMUM_UI_SURFACES,
  type AnswerPart, type AuroraSpec, type AuroraSurface
} from '@@/aurora/src/v2/contracts/answer'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { publishAgentEvent } from '@/core/http-server/http-plugins/leon-services/agent-event-channel'
import { readArtifact } from '@/core/artifacts/artifact-store'
import type { Artifact } from '@/core/artifacts/artifact-types'
import { recordArtifacts } from '@/core/artifacts/artifact-context'
import { validateGeneratedSurfaces } from './generated-validation'

/**
 * Publishes validated presentation trees, bound to the current profile and response.
 * Generated source is checked without executing it in the host.
 * Artifact URLs come from retained files rather than model-provided destinations.
 */
export async function presentAurora(
  sessionId: string,
  messageId: string,
  spec: AuroraSpec,
  purpose: AuroraSurface['purpose'],
  surfaceId?: string
): Promise<AuroraSurface> {
  if (!isAuroraSpec(spec)) {
    throw new Error('The visual answer must be a bounded Aurora component tree with valid references.')
  }
  const issues = validateGeneratedSurfaces(spec)
  if (issues.length) {
    throw new Error(issues.join('\n'))
  }
  const ids = [...new Set(Object.values(spec.elements).flatMap((node) => node.type === 'Artifacts' ? node.props.artifactIds : []))]
  const artifacts = await Promise.all(ids.map(async (id) => (await readArtifact(sessionId, id)).artifact))
  recordArtifacts(artifacts)

  let surface!: AuroraSurface
  const answerParts = CONVERSATION_REPOSITORY.updateAnswerParts(sessionId, messageId, (parts) => {
    const previous = parts.find((part) => part.kind === 'ui' && part.surface.id === surfaceId)
    if (surfaceId && previous?.kind !== 'ui') {
      throw new Error('This visual answer does not belong to the current response.')
    }
    if (previous?.kind === 'ui' && (previous.surface.status !== 'draft' || Object.keys(previous.surface.receipts).length)) {
      throw new Error('An accepted visual answer cannot be replaced.')
    }
    if (!previous && parts.filter((part) => part.kind === 'ui').length >= MAXIMUM_UI_SURFACES) {
      throw new Error('Use the existing visual answer rather than adding more surfaces.')
    }
    surface = { id: surfaceId ?? randomUUID(), revision: previous?.kind === 'ui' ? previous.surface.revision + 1 : 1,
      spec, purpose, status: 'draft', receipts: {} }
    const next = previous ? parts.map((part) => part === previous ? { id: surface.id, kind: 'ui' as const, surface } : part)
      : [...parts, { id: surface.id, kind: 'ui' as const, surface }]
    if (JSON.stringify(next).length > MAXIMUM_ANSWER_UI_CHARACTERS) {
      throw new Error('This visual answer is too large. Use fewer components or retained artifacts.')
    }

    return next
  }, artifacts)
  publishAnswerParts(sessionId, messageId, answerParts, artifacts)

  return surface
}

/**
 * Commits accepted surfaces and orders text/files in the same final-answer body.
 */
export function finishAuroraAnswer(
  sessionId: string, messageId: string, text: string, accepted: boolean, artifacts?: Artifact[]
): AnswerPart[] {
  const existing = CONVERSATION_REPOSITORY.readMessage(sessionId, messageId)
  const retained = artifacts ?? existing?.artifacts ?? []
  if (!existing?.answerParts?.length && !retained.length) {
    return []
  }

  return CONVERSATION_REPOSITORY.updateAnswerParts(sessionId, messageId, (parts) => {
    const ownerMessageId = CONVERSATION_REPOSITORY.getLatestOwnerMessageId(sessionId)
    const ui = parts.filter((part) => part.kind === 'ui').map((part) => ({ ...part,
      surface: { ...part.surface, status: accepted ? 'ready' as const : 'draft' as const,
        ...(ownerMessageId ? { ownerMessageId } : {}) } }))
    const referenced = new Set(ui.flatMap((part) => Object.values(part.surface.spec.elements)
      .flatMap((node) => node.type === 'Artifacts' ? node.props.artifactIds : [])))
    const remaining = retained.filter((artifact) => !referenced.has(artifact.id)).map((artifact) => artifact.id)

    return [...ui,
      ...(text && !(accepted && ui.some((part) => part.surface.purpose === 'clarification'))
        ? [{ id: `${messageId}:text`, kind: 'text' as const, text }] : []),
      ...(remaining.length ? [{ id: `${messageId}:files`, kind: 'artifacts' as const, artifactIds: remaining }] : [])]
  })
}

/**
 * Carries persisted presentation changes through the existing durable replay stream.
 */
export function publishAnswerParts(sessionId: string, messageId: string, answerParts: AnswerPart[], artifacts?: Artifact[]): void {
  publishAgentEvent(getActiveProfileName(), {
    session_id: sessionId, turn_id: null, response_id: messageId,
    type: 'answer_parts', data: { answer_parts: answerParts, ...(artifacts ? { artifacts } : {}) }
  })
}
