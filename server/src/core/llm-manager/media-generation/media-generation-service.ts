import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { registerArtifact } from '@/core/artifacts/artifact-store'
import { attachArtifacts } from '@/core/artifacts/artifact-service'
import {
  resolveMediaGenerationInput,
  GenerationSelectionRequired
} from './media-generation-selection'
import { generateWithProvider } from './media-generation-providers'
import {
  GenerationStatus,
  type GeneratedFile,
  type MediaGenerationInput,
  type MediaGenerationResult,
  type ResolvedMediaGenerationInput
} from './media-generation-types'

export { readGenerationSettings, saveGenerationSettings } from './media-generation-settings'
export { listMediaDefaults } from './media-generation-selection'
export { listMediaCapabilities } from './media-generation-catalog'

/**
 * Imports provider bytes into the same artifact store used by ordinary tools.
 */
export async function persistGeneratedFiles(
  sessionId: string,
  source: string,
  files: GeneratedFile[]
): Promise<MediaGenerationResult> {
  if (!files.length) {
    throw new Error('The provider produced no downloadable files.')
  }

  const root = path.join(
    getSatelliteArtifactRoot(getActiveProfileName(), sessionId),
    'outputs'
  )

  await fs.mkdir(root, { recursive: true })
  const artifacts = []

  for (const file of files) {
    const temporary = path.join(root, randomUUID())

    try {
      await fs.writeFile(temporary, file.data, { flag: 'wx', mode: 0o600 })
      artifacts.push(
        await registerArtifact({
          session_id: sessionId,
          path: temporary,
          filename: path.basename(file.filename),
          mime_type: file.mime_type,
          source
        })
      )
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  await attachArtifacts(
    sessionId,
    artifacts.map((artifact) => artifact.id)
  )

  return { status: GenerationStatus.Completed, artifacts }
}

/**
 * Starts media generation using the owning profile's configured provider account.
 */
export async function generateMedia(
  request: MediaGenerationInput
): Promise<MediaGenerationResult> {
  if (!CONVERSATION_SESSION_MANAGER.getSession(request.session_id)) {
    throw new Error('Conversation session does not exist.')
  }

  let input: ResolvedMediaGenerationInput

  try {
    input = await resolveMediaGenerationInput(request)
  } catch (error) {
    if (error instanceof GenerationSelectionRequired) {
      return {
        status: GenerationStatus.SelectionRequired,
        artifacts: [],
        error: error.message,
        choices: error.choices
      }
    }

    throw error
  }

  if (!input.model.trim() || !input.prompt.trim()) {
    throw new Error('A generation model and prompt are required.')
  }

  input.signal?.throwIfAborted()
  const output = await generateWithProvider(input)

  return persistGeneratedFiles(
    input.session_id,
    `${input.provider}:${input.model}`,
    output.files
  )
}
