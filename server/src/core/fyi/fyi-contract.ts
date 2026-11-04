const MINIMUM_FYI_ANSWER_CHARACTERS = 96

export enum FyiKind {
  Fact = 'fact',
  Mood = 'mood',
  Vision = 'vision'
}

/**
 * A saved post-answer footer, independent of the answer and its execution trace.
 */
export interface Fyi {
  kind: FyiKind
  text: string
}

/**
 * Keeps brief replies footer-free during generation and when displaying saved history.
 */
export function isFyiEligible(answer: string): boolean {
  return answer.trim().length >= MINIMUM_FYI_ANSWER_CHARACTERS
}
