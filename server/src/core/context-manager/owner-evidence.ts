export enum EvidenceSubject {
  Owner = 'owner',
  Other = 'other',
  Assistant = 'assistant',
  Unclear = 'unclear'
}

/**
 * Keep speaker roles explicit without treating the author as every statement's subject.
 */
export function buildOwnerTurnEvidence(
  userMessage: string,
  assistantMessage: string
): Array<{ role: 'user' | 'assistant', speaker: string, content: string }> {
  return [
    { role: 'user', speaker: 'human owner', content: userMessage },
    { role: 'assistant', speaker: 'Leon (assistant)', content: assistantMessage }
  ]
}

/**
 * Accept only matching owner-related subjects; assistant and ambiguous claims stay out.
 */
export function hasOwnerFactAttribution(sourceSubject: unknown, factSubject: unknown): boolean {
  return sourceSubject === factSubject &&
    (sourceSubject === EvidenceSubject.Owner || sourceSubject === EvidenceSubject.Other)
}
