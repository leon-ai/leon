import { AsyncLocalStorage } from 'node:async_hooks'
import type { Artifact } from './artifact-types'

const storage = new AsyncLocalStorage<Map<string, Artifact>>()

/**
 * Collects a turn's deliverables without mixing concurrent profiles or sessions.
 */
export async function collectArtifacts<T>(
  callback: () => Promise<T>
): Promise<{ value: T, artifacts: Artifact[] }> {
  const artifacts = new Map<string, Artifact>()
  const value = await storage.run(artifacts, callback)

  return { value, artifacts: [...artifacts.values()] }
}

/**
 * Records references in the current turn; artifact messages remain independently durable.
 */
export function recordArtifacts(artifacts: Artifact[]): void {
  const current = storage.getStore()

  for (const artifact of artifacts) {
    current?.set(artifact.id, artifact)
  }
}
