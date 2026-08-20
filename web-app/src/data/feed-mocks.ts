import type {
  FeedEntry,
  FeedPlanActivity,
  FeedPlanStep,
  FeedPlanStepStatus,
  FeedSummaryActivity,
  FeedThinkingActivity,
  FeedToolCall,
  FeedToolCallStatus,
  FeedToolsActivity,
  JsonValue,
  LeonFeedEntry
} from './feed'

type MockFeedScenario =
  | 'completed-no-plan'
  | 'in-progress-plan'
  | 'in-progress-no-plan'
  | 'completed-plan'

interface ToolCallOptions {
  functionName: string
  input: JsonValue
  output?: JsonValue
  status: FeedToolCallStatus
  toolCallTitle: string
  toolkitName: string
  toolName: string
  toolIconName: string
}

const MOCK_SCENARIO_BY_QUERY = new Map<string, MockFeedScenario>([
  ['completed with no plan', 'completed-no-plan'],
  ['in progress with plan', 'in-progress-plan'],
  ['in progress with no plan', 'in-progress-no-plan'],
  ['completed with plan', 'completed-plan']
])

const THINKING_DETAILS = [
  'I need to inspect the current environment and collect enough evidence before making changes.',
  'I will use the available system and search tools, then verify the result before finishing.'
]
const THINKING_DURATION_MS = 8_400
const FOLLOW_UP_THINKING_DETAILS = [
  'The first results narrow the issue to the resolved shell configuration.',
  'I need to verify the remaining value before finalizing the change.'
]
const FOLLOW_UP_THINKING_DURATION_MS = 3_600

const FINAL_ANSWER = [
  'Fixed it.',
  '',
  'What was wrong: Ghostty was loading its theme correctly, but the shell configuration was not exposing the expected colors.',
  'The configuration now resolves consistently and the original file remains backed up.'
].join('\n')

function createToolCall({
  functionName,
  input,
  output,
  status,
  toolCallTitle,
  toolkitName,
  toolName,
  toolIconName
}: ToolCallOptions): FeedToolCall {
  return {
    id: window.crypto.randomUUID(),
    toolCallTitle,
    toolkitName,
    toolName,
    toolIconName,
    functionName,
    status,
    input,
    ...(output === undefined ? {} : { output })
  }
}

function createFileReadToolCall(): FeedToolCall {
  return createToolCall({
    toolCallTitle: 'Read Ghostty configuration',
    toolkitName: 'Operating System Control',
    toolName: 'File',
    toolIconName: 'file-text-line',
    functionName: 'read',
    status: 'success',
    input: {
      path: '/home/louis/.config/ghostty/config',
      options: {
        maxChars: 12_000
      }
    },
    output: {
      status: 'success',
      message: 'File read successfully.',
      output: {
        content: 'theme = catppuccin-mocha\nfont-size = 14',
        truncated: false
      }
    }
  })
}

function createSearchToolCall(): FeedToolCall {
  return createToolCall({
    toolCallTitle: 'Check Ghostty theme syntax',
    toolkitName: 'Search & Web',
    toolName: 'Hosted LLM Search',
    toolIconName: 'global-line',
    functionName: 'searchWeb',
    status: 'success',
    input: {
      query: 'Ghostty theme configuration syntax',
      options: {
        provider: 'auto',
        max_output_tokens: 1_200
      }
    },
    output: {
      status: 'success',
      message: 'Search completed.',
      output: {
        result: {
          content: 'Ghostty loads theme values from its user configuration file.'
        }
      }
    }
  })
}

function createShellToolCall(
  status: FeedToolCallStatus,
  toolCallTitle: string
): FeedToolCall {
  const isRunning = status === 'running'

  return createToolCall({
    toolCallTitle,
    toolkitName: 'Operating System Control',
    toolName: 'Shell',
    toolIconName: 'terminal-box-line',
    functionName: 'executeCommand',
    status,
    input: {
      command: 'ghostty +show-config | head -40',
      options: {
        captureOutput: true
      }
    },
    output: isRunning
      ? {
          status: 'running',
          message: 'Reading the resolved Ghostty configuration.'
        }
      : {
          status: 'success',
          message: 'Tool executed successfully.',
          output: {
            result: {
              commandSucceeded: true,
              stdout: 'theme = catppuccin-mocha\nfont-size = 14',
              stderr: '',
              returncode: 0
            }
          }
        }
  })
}

function createPlanStep(
  label: string,
  status: FeedPlanStepStatus,
  toolCalls: FeedToolCall[] = []
): FeedPlanStep {
  return {
    id: window.crypto.randomUUID(),
    label,
    status,
    toolCalls
  }
}

function createPlan(isCompleted: boolean): FeedPlanStep[] {
  return [
    createPlanStep(
      'Inspect the current configuration',
      'completed',
      [createFileReadToolCall(), createSearchToolCall()]
    ),
    createPlanStep(
      'Apply the configuration changes',
      isCompleted ? 'completed' : 'in_progress',
      [createShellToolCall(
        isCompleted ? 'success' : 'running',
        'Apply Ghostty configuration changes'
      )]
    ),
    createPlanStep(
      'Verify the updated setup',
      isCompleted ? 'completed' : 'pending',
      isCompleted
        ? [createShellToolCall('success', 'Verify Ghostty configuration')]
        : []
    )
  ]
}

function createThinkingActivity(
  details: string[],
  durationMs: number,
  isActive: boolean
): FeedThinkingActivity {
  return {
    id: window.crypto.randomUUID(),
    type: 'thinking',
    details,
    durationMs,
    isActive
  }
}

function createSummaryActivity(content: string): FeedSummaryActivity {
  return {
    id: window.crypto.randomUUID(),
    type: 'summary',
    content
  }
}

function createPlanActivity(steps: FeedPlanStep[]): FeedPlanActivity {
  return {
    id: window.crypto.randomUUID(),
    type: 'plan',
    steps
  }
}

function createToolsActivity(toolCalls: FeedToolCall[]): FeedToolsActivity {
  return {
    id: window.crypto.randomUUID(),
    type: 'tools',
    toolCalls
  }
}

function createLeonEntry(scenario: MockFeedScenario): LeonFeedEntry {
  const isInProgress = scenario.startsWith('in-progress')
  const hasPlan = scenario.endsWith('plan') && !scenario.endsWith('no-plan')
  const summary = hasPlan
    ? 'I’ll inspect the current setup, apply the required configuration changes, and verify that Ghostty resolves them correctly.'
    : 'I’ll inspect the configuration and supporting documentation, then apply and verify the smallest safe change.'

  if (hasPlan) {
    return {
      id: window.crypto.randomUUID(),
      role: 'leon',
      activities: [
        createThinkingActivity(
          THINKING_DETAILS,
          THINKING_DURATION_MS,
          false
        ),
        createSummaryActivity(summary),
        createPlanActivity(createPlan(!isInProgress)),
        createThinkingActivity(
          FOLLOW_UP_THINKING_DETAILS,
          FOLLOW_UP_THINKING_DURATION_MS,
          isInProgress
        )
      ],
      finalAnswer: isInProgress ? '' : FINAL_ANSWER
    }
  }

  const firstToolCalls = [createFileReadToolCall(), createSearchToolCall()]
  const finalToolCall = createShellToolCall(
    isInProgress ? 'running' : 'success',
    isInProgress
      ? 'Inspect resolved Ghostty configuration'
      : 'Verify Ghostty configuration'
  )

  return {
    id: window.crypto.randomUUID(),
    role: 'leon',
    activities: [
      createThinkingActivity(THINKING_DETAILS, THINKING_DURATION_MS, false),
      createSummaryActivity(summary),
      createToolsActivity(firstToolCalls),
      createThinkingActivity(
        FOLLOW_UP_THINKING_DETAILS,
        FOLLOW_UP_THINKING_DURATION_MS,
        false
      ),
      createToolsActivity([finalToolCall])
    ],
    finalAnswer: isInProgress ? '' : FINAL_ANSWER
  }
}

/**
 * Builds one owner/Leon exchange from the temporary UI scenario commands.
 */
export function createMockFeedExchange(query: string): FeedEntry[] {
  const scenario = MOCK_SCENARIO_BY_QUERY.get(query.trim().toLowerCase()) ??
    'completed-no-plan'

  return [
    {
      id: window.crypto.randomUUID(),
      role: 'owner',
      content: query
    },
    createLeonEntry(scenario)
  ]
}
