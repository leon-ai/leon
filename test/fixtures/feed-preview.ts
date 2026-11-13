import { FeedTurnStatus, type FeedEntry, type FeedModelProcessingActivity, type FeedToolCall, type LeonFeedActivity, type LeonFeedEntry } from '../../apps/web/src/data/feed'
import { getProcessingCategory } from '../../apps/web/src/data/processing-categories'
import { getProcessingLabel } from '../../apps/web/src/data/activity-labels'
import { TurnPhase, isToolPreparationPhase } from '../../server/src/core/llm-manager/turn-timing-contract'
import { MemoryActivityAction } from '../../server/src/core/llm-manager/memory-activity-contract'
import { PreparationStatus } from '../../aurora/src/v2/contracts/preparation'

export interface FeedPreviewExample {
  id: string
  title: string
  description: string
  kind: 'activity' | 'turn'
  entries: FeedEntry[]
}

/**
 * Supplies bounded, in-memory examples to the real feed renderer without a
 * profile, session transport, tool execution, or provider inference.
 */
export function createFeedPreviewExamples(now: number): FeedPreviewExample[] {
  const startedAt = now - 60_000

  function tool(id: string, title: string, status: FeedToolCall['status'], details: Partial<FeedToolCall> = {}): FeedToolCall {
    return {
      id, toolCallTitle: title, toolkitName: 'Operating system control', toolName: 'Shell',
      toolIconName: 'terminal-line', functionName: 'executeCommand', status,
      startedAt, input: { command: 'pnpm lint' },
      ...details
    }
  }

  function response(id: string, activities: LeonFeedActivity[], details: Partial<LeonFeedEntry> = {}): LeonFeedEntry {
    return {
      id, role: 'leon', status: FeedTurnStatus.InProgress, durationMs: 12_000,
      sentAt: startedAt, activities, finalAnswer: '', ...details
    }
  }

  function processingRequest(goal: TurnPhase, active = false): NonNullable<FeedModelProcessingActivity['requests']>[number] {
    const id = `preview-${goal}`

    return {
      id, ...getProcessingCategory(goal, 'Notion'), durationMs: active ? 0 : 640,
      isActive: active, activeLabel: getProcessingLabel(goal, id, id, 'Notion'),
      isRuntime: isToolPreparationPhase(goal), startedAt
    }
  }

  const succeeded = tool('lint-success', 'Check the project', 'success', {
    durationMs: 1_240, commandOutput: 'Checking source files…\nNo warnings or errors.\nDone in 1.24s.',
    output: { success: true, exitCode: 0 }
  })
  const running = tool('lint-running', 'Check the remaining files', 'running', {
    commandOutput: 'Checking source files…\nReading workspace configuration…'
  })
  const failed = tool('lint-failed', 'Check a missing workspace', 'error', {
    durationMs: 320, input: { command: 'pnpm lint', cwd: './missing-workspace' },
    output: { success: false, error: 'The workspace folder could not be found.' }
  })
  const thoughts: LeonFeedActivity[] = [
    { id: 'thought-finished', type: 'thinking', isActive: false, durationMs: 2_400,
      startedAt, details: ['I will check the existing helpers first.\n\nThen I can keep the change small.'] },
    { id: 'thought-live', type: 'thinking', isActive: true, durationMs: undefined,
      startedAt: startedAt + 3_000, details: ['**Checking the details**\n\nI am comparing the available options.'] }
  ]
  const plan: LeonFeedActivity = {
    id: 'preview-plan', type: 'plan', complete: false, startedAt,
    steps: [
      { id: 'step-done', label: 'Read the project', status: 'completed', toolCalls: [succeeded], startedAt },
      { id: 'step-running', label: 'Check the remaining files', status: 'in_progress', toolCalls: [running],
        startedAt: startedAt + 3_000, activities: [thoughts[0]!, { id: 'step-tools', type: 'tools', toolCalls: [running] }] },
      { id: 'step-pending', label: 'Write a short summary', status: 'pending', toolCalls: [] },
      { id: 'step-failed', label: 'Inspect an unavailable folder', status: 'error', toolCalls: [failed], startedAt }
    ]
  }
  const completedWork: LeonFeedActivity[] = [
    thoughts[0]!,
    { id: 'tools-finished', type: 'tools', toolCalls: [succeeded] },
    { id: 'review-finished', type: 'review', durationMs: 1_200, startedAt: startedAt + 5_000 },
    { id: 'answer-finished', type: 'answer', durationMs: 2_000, startedAt: startedAt + 7_000 },
    { id: 'processing-finished', type: 'processing', durationMs: 1_920,
      requests: [TurnPhase.ToolSchemas, TurnPhase.ToolRequest, TurnPhase.Plan].map((goal) => processingRequest(goal)) }
  ]
  const finishedPlan: LeonFeedActivity = {
    ...plan, id: 'finished-plan', complete: true, durationMs: 7_000,
    steps: plan.steps.filter((step) => step.status !== 'error').map(({ id, label, startedAt, toolCalls }) => ({
      id, label, startedAt, status: 'completed',
      toolCalls: toolCalls.map((call) => ({ ...call, status: 'success', durationMs: 1_240 }))
    }))
  }
  const completed = {
    status: FeedTurnStatus.Completed,
    finalAnswer: 'The project checks are complete.\n\n- The source files passed lint.\n- No additional changes are needed.\n\nThere is room to take the next step whenever you are ready.',
    bonusResponse: 'Small, focused changes are usually easier to review and keep working over time.',
    metrics: {
      inputTokens: 2_400, outputTokens: 320, totalTokens: 2_720, completionCount: 2,
      tokensPerSecond: 48, contextUsedTokens: 3_200, contextWindowTokens: 128_000,
      contextUsagePercent: 2.5, contextUsageEstimated: false,
      usageAccounting: { cachedInputTokens: 1_200, cacheReadCompletionCount: 2 }
    }
  }
  const owner: FeedEntry = {
    id: 'preview-owner', role: 'owner', sentAt: startedAt,
    content: 'Check the project and give me a short summary. Keep the changes small.'
  }

  return [
    {
      id: 'tools', title: 'Tool calls', kind: 'activity',
      description: 'Preparing, running, succeeded and failed calls. Expand a call to read its output or open its details.',
      entries: [response('tools-example', [{ id: 'tools', type: 'tools', toolCalls: [
        tool('tool-preparing', 'Prepare the project check', 'preparing'), running, succeeded, failed,
        tool('tool-download', 'Prepare the speech model', 'preparing', {
          preparation: { status: PreparationStatus.Downloading, detail: 'Downloading the speech model', completed: 36, total: 100 }
        }),
        tool('tool-edit', 'Update the example greeting', 'success', {
          toolName: 'Files', toolIconName: 'file-text-line', functionName: 'editFile', durationMs: 180,
          input: { path: 'src/greeting.ts', changes: [{ oldText: 'export const greeting = \'Hello\'', newText: 'export const greeting = \'Welcome home\'' }] },
          output: { changed: true, diff: '-export const greeting = \'Hello\'\n+export const greeting = \'Welcome home\'' }
        })
      ] }])]
    },
    {
      id: 'plan', title: 'Plan steps', kind: 'activity',
      description: 'Completed, in-progress, pending and failed steps, with nested thoughts and tool calls.',
      entries: [response('plan-example', [plan])]
    },
    {
      id: 'thinking', title: 'Working and thinking', kind: 'activity',
      description: 'General work, a completed thought and an active thought with multi-paragraph Markdown.',
      entries: [response('thinking-example', [{ id: 'working', type: 'working', startedAt }, ...thoughts])]
    },
    {
      id: 'processing', title: 'Model and connection processing', kind: 'activity',
      description: 'Active review, remote connection and tool discovery, followed by the completed processing breakdown.',
      entries: [response('processing-example', [
        ...[TurnPhase.Review, TurnPhase.MCPConnection, TurnPhase.MCPDiscovery].map((goal): LeonFeedActivity => ({
          id: `active-${goal}`, type: 'processing', durationMs: 0, isActive: true, requests: [processingRequest(goal, true)]
        })),
        { id: 'processed', type: 'processing', durationMs: 3_840,
          requests: [TurnPhase.ToolSchemas, TurnPhase.ToolRequest, TurnPhase.Plan, TurnPhase.Inspection,
            TurnPhase.MCPConnection, TurnPhase.MCPDiscovery].map((goal) => processingRequest(goal)) }
      ])]
    },
    {
      id: 'compaction', title: 'History compaction', kind: 'activity',
      description: 'History compaction while it is running, after completion and after a failure.',
      entries: [response('compaction-example', [
        { id: 'compacting', type: 'compaction', status: 'in_progress', startedAt },
        { id: 'compacted', type: 'compaction', status: 'completed', durationMs: 3_200, startedAt },
        { id: 'compaction-failed', type: 'compaction', status: 'error', durationMs: 900, startedAt }
      ])]
    },
    {
      id: 'other', title: 'Progress, memory and turn details', kind: 'activity',
      description: 'Progress, saved memory and skill guidance, review, answer generation, retries and remaining processing time.',
      entries: [response('other-example', [
        { id: 'progress', type: 'summary', content: 'The source files are ready. I am checking the last details.', startedAt },
        { id: 'memory', type: 'summary', content: 'Saved a preference', iconName: 'database-2-line', startedAt,
          memory: { action: MemoryActivityAction.Saved, durationMs: 240,
            entries: [{ id: 'preview-preference', content: 'Keep project changes small and easy to review.' }] } },
        { id: 'skill', type: 'summary', content: 'Loaded project guidance', iconName: 'book-open-line', startedAt,
          skill: { name: 'project-checks', instructions: '# Project checks\n\nRead the existing helpers, run lint and report the results.' } },
        { id: 'review', type: 'review', durationMs: 1_200, startedAt },
        { id: 'answer', type: 'answer', durationMs: 2_000, startedAt },
        { id: 'retries', type: 'retry', count: 2, startedAt },
        { id: 'other-time', type: 'other', durationMs: 420, startedAt }
      ])]
    },
    {
      id: 'code', title: 'Code blocks', kind: 'activity',
      description: 'TypeScript and Python code headers with shared language artwork, syntax coloring and copy actions.',
      entries: [response('code-example', [], {
        status: FeedTurnStatus.Completed,
        finalAnswer: 'A small greeting in two languages.\n\n```typescript\nconst greeting: string = "Welcome home"\nconsole.log(greeting)\n```\n\n```python\ngreeting = "Welcome home"\nprint(greeting)\n```'
      })]
    },
    {
      id: 'running-no-plan', title: 'In progress without a plan', kind: 'turn',
      description: 'A live turn with an owner message, completed reasoning and a running tool call.',
      entries: [owner, response('running-no-plan', [thoughts[0]!, { id: 'live-tools', type: 'tools', toolCalls: [running] }])]
    },
    {
      id: 'completed-no-plan', title: 'Completed without a plan', kind: 'turn',
      description: 'Completed work above the final answer, with an FYI, timestamps and recorded token information.',
      entries: [owner, response('completed-no-plan', completedWork, completed)]
    },
    {
      id: 'running-plan', title: 'In progress with a plan', kind: 'turn',
      description: 'A running plan keeps thoughts and tool calls attached to the current step.',
      entries: [owner, response('running-plan', [{ ...plan, steps: plan.steps.filter((step) => step.status !== 'error') }])]
    },
    {
      id: 'completed-plan', title: 'Completed with a plan', kind: 'turn',
      description: 'The completed plan and its tool calls remain inspectable inside Worked for.',
      entries: [owner, response('completed-plan', [finishedPlan, ...completedWork.filter((activity) => activity.type !== 'tools')], completed)]
    }
  ]
}
