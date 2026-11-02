import type { MemoryActivitySnapshot } from './memory-activity-contract'

/**
 * Captures the guidance loaded for a turn independently of later file changes.
 */
export interface AgentSkillSnapshot {
  name: string
  instructions: string
}

/**
 * Describes a persistent activity shared by the agent runtime and clients.
 */
export interface AgentProgressMessage {
  id: string
  content: string
  createdAt: number
  planStepId?: string | null
  iconName?: string
  skill?: AgentSkillSnapshot
  memory?: MemoryActivitySnapshot
}
