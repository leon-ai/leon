import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { registerArtifact } from '@/core/artifacts/artifact-store'
import { attachArtifacts } from '@/core/artifacts/artifact-service'
import type { LLMProviders } from '@/core/llm-manager/types'
import {
  resolveMediaGenerationInput,
  GenerationSelectionRequired
} from './media-generation-selection'
import { generateWithProvider, pollProviderVideo } from './media-generation-providers'
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

interface VideoJob {
  provider: LLMProviders
  remote_id: string
  filename?: string
  published?: boolean
  result: MediaGenerationResult
}

const activePolls = new Map<string, Promise<MediaGenerationResult>>()

function jobPath(sessionId: string, id: string): string {
  if (
    !id ||
    path.basename(id) !== id ||
    id.includes('\\') ||
    id === './media-generation-service' ||
    id === '..'
  ) {
    throw new Error('Invalid generation job ID.')
  }

  return path.join(
    getSatelliteArtifactRoot(getActiveProfileName(), sessionId),
    'generation-jobs',
    `${id}.json`
  )
}

/**
 * Imports provider bytes into the same artifact store used by ordinary tools.
 */
export async function persistGeneratedFiles(
  sessionId: string,
  source: string,
  files: GeneratedFile[],
  attach = true
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

  if (attach) {
    await attachArtifacts(
      sessionId,
      artifacts.map((artifact) => artifact.id)
    )
  }

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

  if (output.files) {
    return persistGeneratedFiles(
      input.session_id,
      `${input.provider}:${input.model}`,
      output.files
    )
  }

  if (!output.remote_id) {
    throw new Error('Provider returned neither files nor a generation job.')
  }

  const id = randomUUID()
  const result = { status: GenerationStatus.Pending, artifacts: [], job_id: id }
  const filename = jobPath(input.session_id, id)

  await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(
    filename,
    JSON.stringify({
      provider: input.provider,
      remote_id: output.remote_id,
      ...(input.filename ? { filename: input.filename } : {}),
      result
    } satisfies VideoJob),
    { flag: 'wx', mode: 0o600 }
  )

  return result
}

/**
 * Resumes a durable job after reconnect/restart and deduplicates concurrent polls.
 */
export async function getMediaGeneration(
  sessionId: string,
  id: string
): Promise<MediaGenerationResult> {
  if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
    throw new Error('Conversation session does not exist.')
  }

  const filename = jobPath(sessionId, id)
  const existing = activePolls.get(filename)

  if (existing) {
    return existing
  }

  const task = (async (): Promise<MediaGenerationResult> => {
    const job = JSON.parse(await fs.readFile(filename, 'utf8')) as VideoJob
    const save = async (): Promise<void> => {
      const temporary = `${filename}.tmp`

      await fs.writeFile(temporary, JSON.stringify(job), { mode: 0o600 })
      await fs.rename(temporary, filename)
    }

    if (job.result.status === GenerationStatus.Pending) {
      const output = await pollProviderVideo(job.provider, job.remote_id)

      if (output.failed) {
        job.result = {
          status: GenerationStatus.Failed,
          artifacts: [],
          job_id: id,
          error: 'Provider video generation failed.'
        }
      } else if (output.files) {
        job.result = {
          ...(await persistGeneratedFiles(
            sessionId,
            job.provider,
            output.files.map((file) => ({
              ...file,
              filename: job.filename || file.filename
            })),
            false
          )),
          job_id: id
        }
      }

      // Commit the artifact IDs before publication so a restart can replay the same message.
      if (job.result.status !== GenerationStatus.Pending) {
        await save()
      }
    }

    if (job.result.status === GenerationStatus.Completed && !job.published) {
      await attachArtifacts(
        sessionId,
        job.result.artifacts.map((artifact) => artifact.id)
      )
      job.published = true
      await save()
    }

    return job.result
  })()

  activePolls.set(filename, task)
  try {
    return await task
  } finally {
    activePolls.delete(filename)
  }
}
