import sessionsData from './sessions.json'

export enum SessionStatus {
  Idle = 'idle',
  Wip = 'wip'
}

export interface ConversationSession {
  id: string
  title: string
  isTitleGenerated: boolean
  isPinned: boolean
  status: SessionStatus
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
  messageCount: number
  modelTarget: string | null
}

export interface ConversationSessionIndex {
  activeSessionId: string
  sessions: ConversationSession[]
}

export const sessionIndex = {
  ...sessionsData,
  sessions: sessionsData.sessions.map((session, index) => ({
    ...session,
    status: index === 1 ? SessionStatus.Wip : SessionStatus.Idle
  }))
} satisfies ConversationSessionIndex
