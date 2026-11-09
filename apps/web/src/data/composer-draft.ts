import { useTabDraft } from './tab-draft'

/**
 * Keeps the composer on the shared profile-isolated, tab-local draft lifecycle.
 */
export function useComposerDraft(sessionId?: string): [string, (value: string) => void, number] {
  return useTabDraft('composer-draft', [sessionId ?? null])
}
