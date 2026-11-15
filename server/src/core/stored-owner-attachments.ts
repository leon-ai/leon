import fs from 'node:fs/promises'

import { OWNER_ATTACHMENT_MAX_BYTES } from '@/constants'
import { readArtifact } from '@/core/artifacts/artifact-store'
import type { Artifact } from '@/core/artifacts/artifact-types'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { getLLMModelCatalogEntry } from '@/core/llm-manager/llm-model-catalog'
import type { AgentModelFile } from '@/core/llm-manager/types'
import { withOwnerAttachmentReferences } from '@/core/owner-attachments'
import {
  OWNER_ATTACHMENT_SOURCE, OWNER_ATTACHMENT_MAX_COUNT,
  getOwnerAttachmentFormat, getOwnerAttachmentSizeLimit
} from '@/core/owner-attachment-contract'

const MAX_ATTACHMENT_BYTES = OWNER_ATTACHMENT_MAX_BYTES

/**
 * Resolves only owner uploads belonging to the authenticated session. The server
 * rechecks stored metadata instead of accepting paths or MIME claims in messages.
 */
export async function resolveOwnerAttachments(sessionId: string, ids: readonly string[]): Promise<Artifact[]> {
  if (ids.length > OWNER_ATTACHMENT_MAX_COUNT || new Set(ids).size !== ids.length) {
    throw new Error(`I can attach up to ${OWNER_ATTACHMENT_MAX_COUNT} distinct files per message.`)
  }
  const attachments: Artifact[] = []
  for (const id of ids) {
    const resolved = await readArtifact(sessionId, id).catch(() => {
      throw new Error('I could not find an attachment in this session. Please attach it again.')
    })
    const { artifact, path: filename } = resolved
    const format = getOwnerAttachmentFormat(artifact.filename, artifact.mime_type)
    const stat = await fs.stat(filename)
    if (artifact.source !== OWNER_ATTACHMENT_SOURCE || !format || !stat.isFile() ||
      stat.size !== artifact.size_bytes || !stat.size || stat.size > getOwnerAttachmentSizeLimit(format)) {
      throw new Error('This attachment is unavailable or exceeds its file limit.')
    }
    attachments.push(artifact)
  }

  return attachments
}

/**
 * Loads only verified native inputs within the existing inference byte budget.
 * Large uploads stay on disk and remain available through Leon's bounded tools.
 */
export async function prepareStoredOwnerAttachments(query: string, sessionId: string, ids: readonly string[]): Promise<{ query: string, files: AgentModelFile[] }> {
  if (!ids.length) {
    return { query, files: [] }
  }
  const attachments = await resolveOwnerAttachments(sessionId, ids)
  const target = CONFIG_STATE.getModelState().getAgentTarget()
  const supported = target.provider ? getLLMModelCatalogEntry(target.provider, target.model)?.inputMediaTypes : null
  const files: AgentModelFile[] = []
  const references = []
  let nativeBytes = 0
  for (const artifact of attachments) {
    const { path: filename } = await readArtifact(sessionId, artifact.id)
    const nativeInput = Boolean(supported?.includes(artifact.mime_type) && nativeBytes + artifact.size_bytes <= MAX_ATTACHMENT_BYTES)
    references.push({ name: artifact.filename, path: filename, mediaType: artifact.mime_type, nativeInput })
    if (nativeInput) {
      const buffer = await fs.readFile(filename)
      nativeBytes += buffer.length
      files.push({ filename: artifact.filename, mediaType: artifact.mime_type, dataBase64: buffer.toString('base64') })
    }
  }

  return { query: withOwnerAttachmentReferences(query, references), files }
}

