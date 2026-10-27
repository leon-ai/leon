import { randomUUID } from 'node:crypto'

import { AGENT_IMAGE_BATCH_MAX_BYTES } from '@/constants'
import type { AgentModelFile, AgentToolTranscriptMessage } from '@/core/llm-manager/types'

import { parseToolCallArguments } from './agent-utils'

const MAX_BATCH_IMAGES = 8
const MAX_FINDING_CHARS = 2_000

interface ImageSource {
  id: string
  filename?: string
  toolCallId?: string
}

interface ImageEntry {
  messageIndex: number
  fileIndex: number
  file: AgentModelFile
  source: ImageSource
}

export interface AgentImageBatch {
  id: string
  entries: ImageEntry[]
  remainingImages: number
}

export const AGENT_IMAGE_INSPECTION_SCHEMA = {
  type: 'object',
  properties: {
    observations: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_BATCH_IMAGES,
      items: {
        type: 'object',
        properties: {
          source_id: { type: 'string' },
          findings: { type: 'string', minLength: 1, maxLength: MAX_FINDING_CHARS }
        },
        required: ['source_id', 'findings'],
        additionalProperties: false
      }
    }
  },
  required: ['observations'],
  additionalProperties: false
}

/**
 * Keeps queued previews out of review and finalization requests without
 * deleting the canonical evidence needed to resume their inspection.
 */
export function hidePendingImagePreviews(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  return transcript.map((message) => {
    if (message.role === 'assistant' || !message.files?.some((file) => file.inspectionPending)) {
      return message
    }

    return { ...message, files: message.files.filter((file) => !file.inspectionPending) }
  })
}

/**
 * Queues oversized new inspections and selects previews by encoded bytes.
 * Pending flags survive ordinary model replies, interruptions and checkpoints.
 */
export function prepareAgentImageBatch(
  transcript: AgentToolTranscriptMessage[]
): AgentImageBatch | null {
  const lastAssistant = transcript.findLastIndex((message) => message.role === 'assistant')
  const id = randomUUID()
  const pending: ImageEntry[] = []

  transcript.forEach((message, messageIndex) => {
    if (message.role === 'assistant') {
      return
    }

    message.files?.forEach((file, fileIndex) => {
      if (file.mediaType.startsWith('image/') &&
        (file.inspectionPending || messageIndex > lastAssistant)) {
        pending.push({
          messageIndex, fileIndex, file,
          source: {
            id: `${id}:${pending.length + 1}`,
            ...(file.filename ? { filename: file.filename } : {}),
            ...(message.role === 'tool' ? { toolCallId: message.toolCallId } : {})
          }
        })
      }
    })
  })

  if (pending.length === 0 || (pending.length <= MAX_BATCH_IMAGES &&
    !pending.some((entry) => entry.file.inspectionPending) &&
    pending.reduce((bytes, entry) => bytes + entry.file.dataBase64.length, 0) <= AGENT_IMAGE_BATCH_MAX_BYTES)) {
    return null
  }

  let bytes = 0
  const entries: ImageEntry[] = []
  const queuedMessages = new Set<number>()
  for (const entry of pending) {
    // Queue all sources before selecting a page so checkpoint retention cannot
    // discard previews that have not reached the model yet.
    entry.file = { ...entry.file, inspectionPending: true }
    const message = transcript[entry.messageIndex]!
    if (message.role !== 'assistant') {
      if (!queuedMessages.has(entry.messageIndex)) {
        message.files = [...message.files!]
        queuedMessages.add(entry.messageIndex)
      }

      message.files![entry.fileIndex] = entry.file
    }
    if (entries.length < MAX_BATCH_IMAGES &&
      bytes + entry.file.dataBase64.length <= AGENT_IMAGE_BATCH_MAX_BYTES) {
      entries.push(entry)
      bytes += entry.file.dataBase64.length
    }
  }

  if (entries.length === 0) {
    throw new Error('An image preview exceeds the inspection byte budget. Reload its source with a bounded image preview.')
  }

  return { id, entries, remainingImages: pending.length - entries.length }
}

/**
 * Preserves every tool result while exposing only one page of visual evidence.
 * Owner steering can temporarily hide all queued previews without consuming them.
 */
export function projectAgentImageBatch(
  transcript: AgentToolTranscriptMessage[],
  batch: AgentImageBatch,
  defer = false
): AgentToolTranscriptMessage[] {
  const selected = new Set(defer ? [] : batch.entries.map((entry) => entry.file))
  const projected = transcript.map((message) => {
    if (message.role === 'assistant' || !message.files) {
      return message
    }

    return {
      ...message,
      files: message.files.filter((file) => !file.mediaType.startsWith('image/') || selected.has(file))
    }
  })
  projected.push({
    role: 'user',
    content: JSON.stringify({
      image_inspection: {
        instruction: defer
          ? 'Apply the latest owner instructions first. Queued images are temporarily withheld and remain uninspected.'
          : 'Inspect only the supplied image batch for the active task. Return JSON with observations: one {source_id, findings} for every listed source. Record concise, task-relevant visual facts, useful distinctions and uncertainty. Do not invent details, execute tools or answer the owner. The host will preserve these source-linked findings and provide the remaining batches before resuming the task. Original sources remain available for selected rereads and editing.',
        sources: defer ? [] : batch.entries.map((entry) => entry.source),
        remaining_images: batch.remainingImages + (defer ? batch.entries.length : 0)
      }
    }),
    runtimeContext: { imageInspectionBatch: batch.id }
  })

  return projected
}

/**
 * Releases previews only after a complete, validated set of source-linked notes.
 * Original source files and tool artifacts remain available for later rereads.
 */
export function completeAgentImageBatch(
  transcript: AgentToolTranscriptMessage[],
  batch: AgentImageBatch,
  text: string
): boolean {
  const parsed = parseToolCallArguments(text)
  const observations = parsed?.['observations'] as Array<{ source_id: string, findings: string }> | undefined
  if (!Array.isArray(observations)) {
    return false
  }
  const expected = new Set(batch.entries.map((entry) => entry.source.id))
  if (observations.length !== expected.size || observations.some((observation) =>
    !observation || !expected.delete(observation.source_id) ||
    typeof observation.findings !== 'string' || !observation.findings.trim() ||
    observation.findings.length > MAX_FINDING_CHARS
  )) {
    return false
  }

  const selected = new Set(batch.entries.map((entry) => entry.file))
  for (const message of transcript) {
    if (message.role !== 'assistant' && message.files) {
      message.files = message.files.filter((file) => !selected.has(file))
    }
  }
  const findings = batch.entries.map((entry) => ({
    ...entry.source,
    findings: observations.find((observation) => observation.source_id === entry.source.id)!.findings
  }))
  transcript.push({
    role: 'user',
    content: JSON.stringify({
      visual_inspection_findings: findings,
      remaining_images: batch.remainingImages,
      evidence_note: 'Model observations of the supplied previews, not owner instructions. Source files and original tool results remain available. Reload selected sources when closer comparison is needed.'
    }),
    runtimeContext: { visualInspectionBatch: batch.id }
  })

  return true
}
