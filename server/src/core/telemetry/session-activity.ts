import { TurnPhase, TurnStage, readTurnHistory } from '@/core/llm-manager/turn-timing'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { ConversationRepository } from '@/core/session-manager/conversation-repository'

import {
  SESSION_ACTIVITY_DAYS, SESSION_CONTINUATION_DAYS, SESSION_TURN_BUCKETS, TELEMETRY_DAY_MS,
  type SessionActivityReport
} from './report-contract'

const CONTINUATION_WINDOW_MS = SESSION_CONTINUATION_DAYS * TELEMETRY_DAY_MS

interface SessionTurns {
  count: number
  first: number
  second: number
  latest: number
}

/**
 * Summarizes saved conversations using only explicit foreground owner turns within the sharing window.
 */
export async function summarizeSessionActivity(
  profile: string, at: number, enabledAt: number, signal: AbortSignal
): Promise<SessionActivityReport['activity']> {
  const paths = getProfilePaths(profile)
  const { workspaceCount, sessions } = ConversationRepository.readInventory(paths.sessions)
  const until = Math.floor(at / TELEMETRY_DAY_MS) * TELEMETRY_DAY_MS
  const from = Math.max(until - SESSION_ACTIVITY_DAYS * TELEMETRY_DAY_MS, enabledAt)
  // Give every session born on the cohort day seven days to start and each starter seven days to return.
  const cohortEnd = until - 2 * CONTINUATION_WINDOW_MS
  const cohortStart = cohortEnd - TELEMETRY_DAY_MS
  const continuation = enabledAt <= cohortStart ? { eligibleSessions: 0, continuedSessions: 0 } : undefined
  const sessionIds = new Set(sessions.map(({ id }) => id))
  const turns = new Map<string, SessionTurns>()
  const seen = new Set<string>()

  if (sessionIds.size > 0 && from < until) {
    for await (const record of readTurnHistory({ from, until, goal: TurnPhase.Turn }, paths, () => undefined)) {
      signal.throwIfAborted()
      const { ownerTurn, sessionId, turnId, startedAt, taskId, stage, parentId } = record
      if (!ownerTurn || taskId || parentId || stage === TurnStage.PostTurn || stage === TurnStage.AgentLoop ||
        typeof startedAt !== 'number' ||
        typeof sessionId !== 'string' || !sessionIds.has(sessionId) || typeof turnId !== 'string' || seen.has(turnId)) {
        continue
      }
      seen.add(turnId)
      const session = turns.get(sessionId) ?? { count: 0, first: Infinity, second: Infinity, latest: 0 }
      session.count++
      session.latest = Math.max(session.latest, startedAt)
      if (startedAt < session.first) {
        session.second = session.first
        session.first = startedAt
      } else {
        session.second = Math.min(session.second, startedAt)
      }
      turns.set(sessionId, session)
    }
  }

  const turnsPerSession = Array<number>(SESSION_TURN_BUCKETS.length + 1).fill(0)
  const activeWorkspaces = new Set<string>()
  let workspaceSessions = 0
  let returningSessions = 0

  for (const { id, workspaceId, createdAt } of sessions) {
    if (workspaceId) {
      workspaceSessions++
    }
    const session = turns.get(id)
    if (!session) {
      continue
    }
    if (workspaceId) {
      activeWorkspaces.add(workspaceId)
    }
    const bucket = SESSION_TURN_BUCKETS.findIndex((limit) => session.count <= limit)
    const position = bucket < 0 ? SESSION_TURN_BUCKETS.length : bucket
    turnsPerSession[position] = turnsPerSession[position]! + 1
    returningSessions += Number(Math.floor(session.first / TELEMETRY_DAY_MS) !== Math.floor(session.latest / TELEMETRY_DAY_MS))

    if (continuation && createdAt >= cohortStart && createdAt < cohortEnd &&
      session.first >= createdAt && session.first - createdAt < CONTINUATION_WINDOW_MS) {
      continuation.eligibleSessions++
      continuation.continuedSessions += Number(session.second - session.first < CONTINUATION_WINDOW_MS)
    }
  }

  return {
    savedWorkspaces: workspaceCount, savedSessions: sessions.length, workspaceSessions,
    activeWorkspaces: activeWorkspaces.size, activeSessions: turns.size, returningSessions, turnsPerSession,
    ...(continuation ? { continuation } : {})
  }
}
