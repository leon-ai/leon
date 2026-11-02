import MEMORY_TOOL_CONFIG from '@@/tools/structured_knowledge/memory/tool.json' with { type: 'json' }
import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import { MemoryActivityAction, type MemoryActivityEntry, type MemoryChange } from '@/core/llm-manager/memory-activity-contract'
import { StringHelper } from '@/helpers/string-helper'
import { LogHelper } from '@/helpers/log-helper'
import type { MemoryRecord } from './types'

export const MEMORY_ACTIVITY_ICON_NAME = MEMORY_TOOL_CONFIG.icon_name

/**
 * Builds a bounded outcome row from committed facts; clients format measured time.
 */
export function createMemoryActivity(
  id: string,
  action: MemoryActivityAction,
  entries: MemoryActivityEntry[],
  createdAt: number,
  durationMs?: number
): AgentProgressMessage {
  const count = entries.length
  const labels: Record<MemoryActivityAction, string> = {
    [MemoryActivityAction.Saved]: `Saved ${count} ${count === 1 ? 'memory' : 'memories'}`,
    [MemoryActivityAction.Updated]: `Updated ${count} ${count === 1 ? 'memory' : 'memories'}`,
    [MemoryActivityAction.TemporarySaved]: 'Saved temporary context',
    [MemoryActivityAction.TemporaryUpdated]: 'Updated temporary context',
    [MemoryActivityAction.TemporaryEnded]: 'Ended temporary context',
    [MemoryActivityAction.TemporaryLoaded]: 'Loaded temporary context',
    [MemoryActivityAction.ExperienceLearned]: 'Learned an experience',
    [MemoryActivityAction.ExperienceUpdated]: 'Updated an experience'
  }

  return {
    id, content: labels[action], createdAt, planStepId: null, iconName: MEMORY_ACTIVITY_ICON_NAME,
    memory: { action, entries, ...(durationMs === undefined ? {} : { durationMs }) }
  }
}

/**
 * Reports a successful mutation without allowing presentation failures to undo it.
 */
export function reportMemoryChange(
  observer: ((change: MemoryChange) => void) | undefined,
  action: MemoryActivityAction,
  record: MemoryRecord,
  previous?: MemoryRecord | null
): void {
  if (!observer) {
    return
  }
  try {
    observer({ action, entry: {
      id: record.id,
      content: StringHelper.redactSecrets(record.content),
      sourceRef: record.sourceRef,
      ...(record.expiresAt == null ? {} : { expiresAt: new Date(record.expiresAt).toISOString() }),
      ...(previous ? { previousContent: StringHelper.redactSecrets(previous.content) } : {})
    } })
  } catch {
    LogHelper.warning('Could not report a committed memory activity.')
  }
}
