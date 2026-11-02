import type { AgentSkillSnapshot } from '../../../../../server/src/core/llm-manager/agent-progress-contract'
import { CodeView } from '@/components/code-view'
import { ActivityDetails } from './activity-details'
import { useOpenSkillDetails } from './activity-details-provider'

/**
 * Previews the turn's loaded guidance and opens its complete saved instructions.
 */
export function SkillDetails({ skill }: { skill: AgentSkillSnapshot }) {
  const openDetails = useOpenSkillDetails(skill)
  const filename = `${skill.name}/SKILL.md`

  return (
    <ActivityDetails title={filename} onViewDetails={openDetails}>
      <CodeView text={skill.instructions} language="markdown" label={filename} preview />
    </ActivityDetails>
  )
}
