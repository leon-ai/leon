export type MemoryScope = 'persistent' | 'daily' | 'discussion'

export type KnowledgeNamespace =
  | 'context'
  | 'memory_persistent'
  | 'memory_daily'
  | 'memory_discussion'
  | 'conversation_daily'

export type RecallRetrievalMode = 'hybrid' | 'lexical'

export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'event'
  | 'note'
  | 'summary'
  | 'knowledge'
  | 'task'

export type MemorySourceType =
  | 'explicit_user'
  | 'inferred'
  | 'tool_output'
  | 'conversation'
  | 'system'

export interface MemoryWriteInput {
  scope: MemoryScope
  kind: MemoryKind
  title?: string
  content: string
  sourceType: MemorySourceType
  sourceRef?: string
  importance?: number
  confidence?: number
  tags?: string[]
  dayKey?: string
  expiresAt?: number | null
  isPinned?: boolean
  supersedesItemId?: string
  metadata?: Record<string, unknown>
}

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  title: string | null
  content: string
  importance: number
  confidence: number
  dayKey: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  isPinned: boolean
  metadata: Record<string, unknown>
}

export interface RecallQuery {
  query: string
  namespaces?: KnowledgeNamespace[]
  contextFilenames?: string[]
  scopes?: MemoryScope[]
  kinds?: MemoryKind[]
  dayKeys?: string[]
  topK?: number
  tokenBudget?: number
  includeFacts?: boolean
  skipContextSync?: boolean
  retrievalMode?: RecallRetrievalMode
}

export interface RecallHit {
  chunkId: string
  itemId: string
  namespace: KnowledgeNamespace
  scope: MemoryScope | null
  kind: MemoryKind | null
  title: string | null
  content: string
  bm25Score: number
  rerankScore?: number
  createdAt: number
  sourcePath?: string | null
}

export interface RecallResult {
  hits: RecallHit[]
  facts: Array<{
    key: string
    value: unknown
    text: string
    priority: number
  }>
  promptText: string
  usedTokenEstimate: number
}

export interface TurnObservationInput {
  userMessage: string
  assistantMessage: string
  sentAt: number
  route: 'react' | 'controlled' | 'pulse'
  toolExecutions?: Array<{
    functionName: string
    status: 'success' | 'error'
    observation: string
  }>
}
