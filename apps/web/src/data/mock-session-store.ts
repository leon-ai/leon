const initialQueriesBySessionId = new Map<string, string>()

/**
 * Temporarily associates the first owner query with a mock session route.
 * The server-backed session store will replace this registry later.
 */
export function setMockSessionInitialQuery(
  sessionId: string,
  query: string
): void {
  initialQueriesBySessionId.set(sessionId, query)
}

/**
 * Returns the initial mock query previously associated with a session route.
 */
export function getMockSessionInitialQuery(sessionId: string): string | null {
  return initialQueriesBySessionId.get(sessionId) ?? null
}

