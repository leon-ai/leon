import { TurnPhase } from '../../../../server/src/core/llm-manager/turn-timing-contract'

const WORKING_LABELS = [
  'Working...', 'Here with you...', 'Right here...', 'Let me see...',
  'Taking a look...', 'Just a moment...', 'One little moment...', 'Working on this...',
  'Working with care...', 'Putting this together...'
] as const

const PROCESSING_LABELS = [
  'Processing...', 'Taking a look...', 'Considering the details...', 'Looking more closely...',
  'Reading the details...', 'Exploring your request...', 'Reviewing the context...', 'Considering your request...',
  'Checking the details...', 'Working through this...'
] as const

const TOOL_SCHEMA_LABELS = [
  'Loading tools...', 'Gathering my tools...', 'Getting tools ready...', 'Preparing my tools...',
  'Loading tool details...', 'Fetching tool details...', 'Reading tool details...', 'Checking available tools...',
  'Reading tool instructions...', 'Reviewing tool details...'
] as const

const TOOL_REQUEST_LABELS = [
  'Preparing tool calls...', 'Choosing a tool...', 'Choosing my tools...', 'Preparing tool requests...',
  'Organizing tool calls...', 'Preparing tool inputs...', 'Considering available tools...', 'Arranging tool requests...',
  'Checking tool details...', 'Selecting a tool...'
] as const

const SKILL_LABELS = [
  'Loading skills...', 'Finding a skill...', 'Opening skill guides...', 'Reading skill instructions...',
  'Gathering skill details...', 'Preparing a skill...', 'Browsing my skills...', 'Checking skill guides...',
  'Fetching skill details...', 'Reviewing skill instructions...'
] as const

const PLAN_LABELS = [
  'Updating the plan...', 'Arranging the steps...', 'Preparing a plan...', 'Reviewing the plan...',
  'Considering the steps...', 'Organizing the steps...', 'Refining the steps...', 'Preparing the steps...',
  'Adjusting the plan...', 'Planning ahead...'
] as const

const CLARIFICATION_LABELS = [
  'Preparing a question...', 'Considering a question...', 'Writing a question...', 'Checking missing details...',
  'Preparing my question...', 'Gathering my questions...', 'Preparing to ask...', 'Checking with you...',
  'Choosing my question...', 'Refining my question...'
] as const

const CANCELLATION_LABELS = [
  'Preparing to stop...', 'Stopping this task...', 'Closing this task...', 'Noting your change...',
  'Noting your request...', 'Acknowledging your change...', 'Preparing to pause...', 'Closing this request...',
  'Stopping here...', 'Acknowledging your request...'
] as const

const CONNECTION_LABELS = [
  'Preparing connection setup...', 'Getting setup ready...', 'Preparing the connection...', 'Gathering setup details...',
  'Preparing to connect...', 'Reading connection details...', 'Preparing connection guidance...', 'Arranging setup steps...',
  'Opening setup notes...', 'Organizing setup details...'
] as const

const ANSWER_LABELS = [
  'Generating an answer...', 'Writing my reply...', 'Preparing the answer...', 'Choosing my words...',
  'Preparing my reply...', 'Writing a reply...', 'Writing this carefully...', 'Forming the answer...',
  'Composing an answer...', 'Composing my reply...'
] as const

const REVIEW_LABELS = [
  'Reviewing...', 'Taking another look...', 'One more look...', 'Checking the details...',
  'Reviewing my work...', 'Checking my work...', 'Reviewing the result...', 'Checking this carefully...',
  'Checking the result...', 'Reviewing the details...'
] as const

const INSPECTION_LABELS = [
  'Inspecting images...', 'Checking the picture...', 'Studying the picture...', 'Looking more closely...',
  'Checking visual details...', 'Reading the image...', 'Examining the image...', 'Studying image details...',
  'Exploring the picture...', 'Inspecting the details...'
] as const

const COMPACTION_LABELS = [
  'Compacting context...', 'Summarizing the context...', 'Gathering the essentials...', 'Organizing the context...',
  'Shortening the context...', 'Organizing my notes...', 'Keeping the essentials...', 'Tidying my notes...',
  'Combining my notes...', 'Summarizing my notes...'
] as const

const PHASE_LABELS: Readonly<Partial<Record<TurnPhase, readonly string[]>>> = {
  [TurnPhase.Request]: PROCESSING_LABELS,
  [TurnPhase.Tools]: TOOL_REQUEST_LABELS,
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
