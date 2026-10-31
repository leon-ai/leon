import { TurnPhase } from '../../../../server/src/core/llm-manager/turn-timing-contract'
import { InferencePurpose, LLMDuties } from '../../../../server/src/core/llm-manager/inference-contract'

interface ProcessingCategory {
  label: string
  iconName: string
}

const DEFAULT_CATEGORY: ProcessingCategory = {
  label: 'Processed request for',
  iconName: 'cpu-line'
}

const CATEGORIES: Readonly<Partial<Record<string, ProcessingCategory>>> = {
  // Older traces combine schema loading and execution under the same goal.
  [TurnPhase.Tools]: { label: 'Processed tool request in', iconName: 'tools-line' },
  [TurnPhase.ToolSchemas]: { label: 'Loaded tool schemas in', iconName: 'stack-line' },
  [TurnPhase.ToolRequest]: { label: 'Requested tools in', iconName: 'tools-line' },
  [TurnPhase.Skill]: { label: 'Loaded skills in', iconName: 'book-open-line' },
  [TurnPhase.Plan]: { label: 'Updated plan in', iconName: 'list-check-3' },
  [TurnPhase.Clarification]: { label: 'Requested clarification in', iconName: 'question-mark' },
  [TurnPhase.Cancellation]: { label: 'Acknowledged cancellation in', iconName: 'close-circle-line' },
  [TurnPhase.Connection]: { label: 'Requested connection setup in', iconName: 'plug-line' },
  [TurnPhase.Answer]: { label: 'Generated answer in', iconName: 'pencil-ai-line' },
  [TurnPhase.Review]: { label: 'Reviewed for', iconName: 'search-eye-line' },
  [TurnPhase.Inspection]: { label: 'Inspected images in', iconName: 'eye-2-line' },
  [TurnPhase.Compaction]: { label: 'Compacted context in', iconName: 'file-reduce-line' },
  [LLMDuties.SkillRouter]: { label: 'Routed request in', iconName: 'route-line' },
  [LLMDuties.ActionCalling]: { label: 'Selected action in', iconName: 'function-line' },
  [LLMDuties.SlotFilling]: { label: 'Filled parameters in', iconName: 'input-field' },
  [LLMDuties.Paraphrase]: { label: 'Rephrased answer in', iconName: 'chat-smile-2-line' },
  [InferencePurpose.SessionTitle]: { label: 'Generated session title in', iconName: 'price-tag-3-line' },
  [InferencePurpose.Memory]: { label: 'Extracted memories in', iconName: 'database-2-line' },
  [InferencePurpose.OwnerProfile]: { label: 'Updated owner profile in', iconName: 'user-settings-line' },
  [InferencePurpose.SelfModel]: { label: 'Reflected for', iconName: 'brain-line' },
  [InferencePurpose.PulsePlanning]: { label: 'Planned proactive work in', iconName: 'pulse-line' },
  [InferencePurpose.PulseReaction]: { label: 'Assessed owner reaction in', iconName: 'pulse-line' },
  [InferencePurpose.Pulse]: { label: 'Processed proactive work for', iconName: 'pulse-line' },
  [InferencePurpose.ProviderTool]: { label: 'Processed tool inference for', iconName: 'cpu-line' }
}

/**
 * Keeps inference labels and icons consistent without guessing unknown goals.
 * Categories describe existing work; they never schedule additional inference.
 */
export function getProcessingCategory(goal: string): ProcessingCategory {
  return Object.hasOwn(CATEGORIES, goal) ? CATEGORIES[goal]! : DEFAULT_CATEGORY
}
