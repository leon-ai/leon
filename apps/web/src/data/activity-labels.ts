import { TurnPhase } from '../../../../server/src/core/llm-manager/turn-timing-contract'

const WORKING_LABELS = [
  'Working...',
  'Working on this...',
  'Working with care...',
  'Working through this...',
  'Handling your request...',
  'Continuing this task...',
  'Giving this attention...',
  'Giving this care...',
  'Working with you...',
  'Helping with this...'
] as const

const PROCESSING_LABELS = [
  'Processing...',
  'Processing your request...',
  'Considering your request...',
  'Reading your request...',
  'Reading the context...',
  'Considering the context...',
  'Understanding your request...',
  'Exploring your request...',
  'Interpreting your request...',
  'Checking your request...'
] as const

const TOOL_SCHEMA_LABELS = [
  'Loading tools...',
  'Loading tool guides...',
  'Loading tool details...',
  'Reading tool guides...',
  'Reading tool details...',
  'Reading tool instructions...',
  'Getting tool details...',
  'Opening tool guides...',
  'Checking tool instructions...',
  'Getting tools ready...'
] as const

const TOOL_SELECTION_LABELS = [
  'Choosing tools...',
  'Choosing a tool...',
  'Selecting tools...',
  'Selecting helpful tools...',
  'Finding suitable tools...',
  'Choosing suitable tools...',
  'Matching available tools...',
  'Checking tool options...',
  'Considering tool options...',
  'Comparing tool options...'
] as const

const TOOL_REQUEST_LABELS = [
  'Preparing tool calls...',
  'Preparing tool inputs...',
  'Writing tool inputs...',
  'Preparing tool requests...',
  'Writing tool requests...',
  'Building tool calls...',
  'Building tool requests...',
  'Organizing tool calls...',
  'Arranging tool requests...',
  'Setting tool inputs...'
] as const

const SKILL_LABELS = [
  'Loading skills...',
  'Loading skill guides...',
  'Opening skill guides...',
  'Reading skill guides...',
  'Reading skill instructions...',
  'Loading skill instructions...',
  'Getting skill details...',
  'Reading skill details...',
  'Checking skill instructions...',
  'Gathering skill guidance...'
] as const

const PLAN_LABELS = [
  'Updating the plan...',
  'Arranging the steps...',
  'Preparing a plan...',
  'Planning next steps...',
  'Organizing the steps...',
  'Adjusting the plan...',
  'Improving the plan...',
  'Choosing next steps...',
  'Setting plan steps...',
  'Writing plan steps...'
] as const

const CLARIFICATION_LABELS = [
  'Preparing a question...',
  'Writing a question...',
  'Preparing my question...',
  'Choosing my question...',
  'Writing my question...',
  'Preparing to ask...',
  'Clarifying my question...',
  'Checking my question...',
  'Organizing my questions...',
  'Reviewing my question...'
] as const

const CANCELLATION_LABELS = [
  'Preparing to stop...',
  'Stopping this task...',
  'Ending this task...',
  'Stopping this work...',
  'Preparing to cancel...',
  'Canceling this task...',
  'Stopping this request...',
  'Ending this request...',
  'Stopping my work...',
  'Ending this work...'
] as const

const CONNECTION_LABELS = [
  'Preparing connection setup...',
  'Preparing the connection...',
  'Preparing to connect...',
  'Reading connection details...',
  'Checking setup details...',
  'Preparing setup steps...',
  'Organizing setup steps...',
  'Reading setup instructions...',
  'Checking connection details...',
  'Preparing connection guidance...'
] as const

const ANSWER_LABELS = [
  'Generating an answer...',
  'Writing my answer...',
  'Preparing my reply...',
  'Writing my reply...',
  'Preparing the answer...',
  'Choosing my words...',
  'Forming the answer...',
  'Building my answer...',
  'Writing the answer...',
  'Putting words together...'
] as const

const REVIEW_LABELS = [
  'Reviewing...',
  'Checking my answer...',
  'Reviewing my work...',
  'Checking my work...',
  'Reviewing the answer...',
  'Checking the answer...',
  'Reviewing the result...',
  'Checking the result...',
  'Checking answer details...',
  'Reviewing answer details...'
] as const

const INSPECTION_LABELS = [
  'Inspecting images...',
  'Inspecting the image...',
  'Reading image details...',
  'Checking the picture...',
  'Studying the picture...',
  'Checking visual details...',
  'Reading the image...',
  'Examining the image...',
  'Studying image details...',
  'Checking image contents...'
] as const

const COMPACTION_LABELS = [
  'Compacting context...',
  'Summarizing earlier messages...',
  'Shortening the context...',
  'Summarizing the context...',
  'Shortening earlier messages...',
  'Summarizing earlier work...',
  'Keeping key context...',
  'Keeping useful context...',
  'Saving context space...',
  'Freeing context space...'
] as const

const PHASE_LABELS: Readonly<Partial<Record<TurnPhase, readonly string[]>>> = {
  [TurnPhase.Request]: PROCESSING_LABELS,
  [TurnPhase.Tools]: TOOL_SELECTION_LABELS,
  [TurnPhase.ToolSchemas]: TOOL_SCHEMA_LABELS,
  [TurnPhase.ToolRequest]: TOOL_REQUEST_LABELS,
  [TurnPhase.Skill]: SKILL_LABELS,
  [TurnPhase.Plan]: PLAN_LABELS,
  [TurnPhase.Clarification]: CLARIFICATION_LABELS,
  [TurnPhase.Cancellation]: CANCELLATION_LABELS,
  [TurnPhase.Connection]: CONNECTION_LABELS,
  [TurnPhase.Answer]: ANSWER_LABELS,
  [TurnPhase.Review]: REVIEW_LABELS,
  [TurnPhase.Inspection]: INSPECTION_LABELS,
  [TurnPhase.Compaction]: COMPACTION_LABELS
}

/**
 * Chooses stable copy without timers or a cache, including virtualized remounts.
 */
export function getActivityLabel(id: string, labels: readonly string[] = WORKING_LABELS): string {
  let index = 0
  for (const character of id) {
    index = (index + character.codePointAt(0)!) % labels.length
  }

  return labels[index]!
}

/**
 * Names only the recorded inference goal; unknown purposes keep neutral copy.
 */
export function getProcessingLabel(goal: string, id: string): string {
  const labels = Object.hasOwn(PHASE_LABELS, goal) ? PHASE_LABELS[goal as TurnPhase]! : PROCESSING_LABELS

  return getActivityLabel(id, labels)
}
