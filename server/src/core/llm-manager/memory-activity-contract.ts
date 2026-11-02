/**
 * Describes observed memory operations independently of model reasoning.
 */
export enum MemoryActivityAction {
  Saved = 'saved',
  Updated = 'updated',
  TemporarySaved = 'temporary_saved',
  TemporaryUpdated = 'temporary_updated',
  TemporaryEnded = 'temporary_ended',
  TemporaryLoaded = 'temporary_loaded',
  ExperienceLearned = 'experience_learned',
  ExperienceUpdated = 'experience_updated'
}

export interface MemoryActivityEntry {
  id: string
  content: string
  sourceRef?: string | null
  expiresAt?: string | null
  previousContent?: string
}

export interface MemoryChange {
  action: MemoryActivityAction
  entry: MemoryActivityEntry
}

export interface MemoryActivitySnapshot {
  action: MemoryActivityAction
  entries: MemoryActivityEntry[]
  durationMs?: number
}
