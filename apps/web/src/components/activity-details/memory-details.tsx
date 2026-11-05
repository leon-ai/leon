import type { MemoryActivitySnapshot } from '../../../../../server/src/core/llm-manager/memory-activity-contract'
import { CodeView } from '@/components/code-view'
import { ActivityDetails } from './activity-details'
import { useOpenTextActivityDetails } from './activity-details-provider'

/**
 * Keeps committed facts, sources and validity inspectable outside a virtualized row.
 */
export function MemoryDetails({ memory, title }: { memory: MemoryActivitySnapshot, title: string }) {
  const content = JSON.stringify(memory.entries, null, 2)
  const openDetails = useOpenTextActivityDetails({
    title, content, path: 'memory.json', contentName: 'memory', language: 'json'
  })

  return (
    <ActivityDetails title={title} onViewDetails={openDetails}>
      <CodeView text={content} language="json" label="Memory" preview />
    </ActivityDetails>
  )
}
