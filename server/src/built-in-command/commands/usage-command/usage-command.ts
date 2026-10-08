import dayjs from 'dayjs'

import {
  BuiltInCommand,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult,
  type BuiltInCommandRenderListItem
} from '@/built-in-command/built-in-command'
import {
  createListResult,
  renderBuiltInCommandResult
} from '@/built-in-command/built-in-command-renderer'
import {
  readInferenceUsage,
  type InferenceUsageQuery,
  type InferenceUsageRecord
} from '@/core/llm-manager/llm-usage/usage-ledger'
import type { InferenceUsage } from '@/core/llm-manager/llm-usage/usage-context'
import { InferenceAuthMode } from '@/core/llm-manager/inference-metadata'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { DateHelper } from '@/helpers/date-helper'

enum UsagePeriod {
  Today = 'today',
  Week = 'week',
  Session = 'session'
}

const USAGE_PERIODS = Object.values(UsagePeriod)
const USAGE_DAY_FORMAT = 'YYYY-MM-DD'
const DAYS_PER_WEEK = 7
const TOKEN_METRICS = [
  ['inputTokens', 'Input'],
  ['cachedInputTokens', 'Cached input'],
  ['cacheWriteInputTokens', 'Cache writes'],
  ['outputTokens', 'Output'],
  ['reasoningOutputTokens', 'Reasoning output']
] as const
const AUTH_LABELS: Record<InferenceAuthMode, string> = {
  [InferenceAuthMode.APIKey]: 'API key',
  [InferenceAuthMode.ChatGPTOAuth]: 'ChatGPT subscription',
  [InferenceAuthMode.ClaudeSubscription]: 'Claude subscription',
  [InferenceAuthMode.None]: 'No authentication'
}
const NUMBER_FORMATTER = new Intl.NumberFormat()
const COST_FORMATTER = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6
})

interface UsageTotal {
  requests: number
  historicalTurns: number
  historicalCompletions: number
  historicalTurnsWithoutCount: number
  failed: number
  totalTokens: number
  totalTokenCoverage: number
  values: InferenceUsage
  coverage: Partial<Record<keyof InferenceUsage, number>>
}

function createUsageTotal(): UsageTotal {
  return {
    requests: 0,
    historicalTurns: 0,
    historicalCompletions: 0,
    historicalTurnsWithoutCount: 0,
    failed: 0,
    totalTokens: 0,
    totalTokenCoverage: 0,
    values: {},
    coverage: {}
  }
}

function addUsage(total: UsageTotal, record: InferenceUsageRecord): void {
  if (record.historical) {
    total.historicalTurns += 1
    total.historicalCompletions += record.historical.completionCount ?? 0
    total.historicalTurnsWithoutCount += record.historical.completionCount === undefined ? 1 : 0
  } else {
    total.requests += 1
    total.failed += record.outcome === 'completed' ? 0 : 1
  }

  const { inputTokens, outputTokens } = record.usage

  if (
    typeof inputTokens === 'number' && Number.isFinite(inputTokens) && inputTokens >= 0 &&
    typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0
  ) {
    total.totalTokens += inputTokens + outputTokens
    total.totalTokenCoverage += 1
  }

  for (const key of [...TOKEN_METRICS.map(([metric]) => metric), 'costUSD'] as const) {
    const value = record.usage[key]

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      continue
    }

    // Estimated costs and subscription-equivalent prices are not actual charges.
    if (key === 'costUSD' && record.usage.costEstimated) {
      continue
    }

    total.values[key] = (total.values[key] ?? 0) + value
    total.coverage[key] = (total.coverage[key] ?? 0) + 1
  }
}

function coverageLabel(total: UsageTotal, count: number): string {
  const records = total.requests + total.historicalTurns
  const unit = total.historicalTurns > 0 ? 'records' : 'requests'

  return `${count}/${records} ${unit} reported`
}

function formatMetric(total: UsageTotal, key: keyof InferenceUsage): string {
  const count = total.coverage[key] ?? 0
  const value = total.values[key]

  if (count === 0 || typeof value !== 'number') {
    return 'unavailable'
  }

  const formatted = key === 'costUSD'
    ? COST_FORMATTER.format(value)
    : NUMBER_FORMATTER.format(value)

  return count === total.requests + total.historicalTurns
    ? formatted
    : `${formatted} (${coverageLabel(total, count)})`
}

function formatUsage(total: UsageTotal): string {
  if (total.requests + total.historicalTurns === 0) {
    return 'No recorded requests'
  }

  const tokens = total.totalTokenCoverage === 0
    ? 'unavailable'
    : NUMBER_FORMATTER.format(total.totalTokens) +
      (total.totalTokenCoverage < total.requests + total.historicalTurns
        ? ` (${coverageLabel(total, total.totalTokenCoverage)})`
        : '')

  return [
    `${NUMBER_FORMATTER.format(total.requests)} requests`,
    ...(total.historicalTurns > 0 ? [
      `${NUMBER_FORMATTER.format(total.historicalTurns)} historical turns`,
      `${NUMBER_FORMATTER.format(total.historicalCompletions)} recorded historical completions`,
      ...(total.historicalTurnsWithoutCount > 0
        ? [`${total.historicalTurnsWithoutCount} historical turns without completion counts`] : [])
    ] : []),
    ...(total.failed > 0 ? [`${total.failed} unsuccessful`] : []),
    `Total tokens: ${tokens}`,
    ...TOKEN_METRICS.map(([key, label]) => `${label}: ${formatMetric(total, key)}`),
    `Reported cost: ${formatMetric(total, 'costUSD')}`
  ].join(' · ')
}

function addGroupedUsage(
  groups: Map<string, UsageTotal>,
  key: string,
  record: InferenceUsageRecord
): void {
  const total = groups.get(key) ?? createUsageTotal()

  addUsage(total, record)
  groups.set(key, total)
}

function groupItems(groups: Map<string, UsageTotal>): BuiltInCommandRenderListItem[] {
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, total]) => ({ label, value: formatUsage(total) }))
}

/**
 * Reports profile-owned inference usage across model and connection changes.
 */
export class UsageCommand extends BuiltInCommand {
  protected override description = 'Show lifetime inference usage, or filter by today, week or session.'
  protected override icon_name = 'ri-bar-chart-line'
  protected override supported_usages = [
    '/usage',
    '/usage today',
    '/usage week',
    '/usage session'
  ]
  protected override help_usage = '/usage [today|week|session]'

  public constructor() {
    super('usage')
  }

  /**
   * Suggests the available reporting periods through Leon's command UI.
   */
  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    if (context.args.length > 1 || (context.args.length === 1 && context.ends_with_space)) {
      return []
    }

    return USAGE_PERIODS
      .filter((period) => period.startsWith(context.args[0]?.toLowerCase() || ''))
      .map((period) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: period,
        description: `Show ${period === UsagePeriod.Week ? 'the last seven days of' : period} usage.`,
        usage: `/usage ${period}`,
        supported_usages: this.getSupportedUsages(),
        value: `/usage ${period}`
      }))
  }

  /**
   * Summarizes recorded counters and their coverage without estimating missing data.
   */
  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const period = context.args[0]?.toLowerCase()

    if (context.args.length > 1 || (period !== undefined && !USAGE_PERIODS.includes(period as UsagePeriod))) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Usage: /usage [today|week|session]',
          tone: 'error',
          items: []
        })
      }
    }

    const timeZone = DateHelper.getTimeZone()
    const today = dayjs(DateHelper.getDateTime()).tz(timeZone)
    const query: InferenceUsageQuery = {}

    if (period === UsagePeriod.Session) {
      query.sessionId = CONVERSATION_SESSION_MANAGER.getCurrentSessionId()
    } else if (period !== undefined) {
      query.from = dayjs.tz(
        today.subtract(period === UsagePeriod.Week ? DAYS_PER_WEEK - 1 : 0, 'day')
          .format(USAGE_DAY_FORMAT),
        timeZone
      ).valueOf()
      query.until = dayjs.tz(today.add(1, 'day').format(USAGE_DAY_FORMAT), timeZone).valueOf()
    }

    const total = createUsageTotal()
    const models = new Map<string, UsageTotal>()
    const purposes = new Map<string, UsageTotal>()
    const days = new Map<string, UsageTotal>()

    for await (const record of readInferenceUsage(query)) {
      const inference = record.inference
      const authentication = inference
        ? AUTH_LABELS[inference.authMode]
        : 'Authentication unavailable'
      const connection = inference?.connectionRef
        ? `connection ${inference.connectionRef}`
        : inference?.credentialSource || ''
      const model = [record.provider, record.model, authentication, connection]
        .filter(Boolean).join(' / ')

      addUsage(total, record)
      addGroupedUsage(models, model, record)
      addGroupedUsage(purposes, record.purpose, record)
      addGroupedUsage(
        days,
        dayjs(record.startedAt).tz(timeZone).format(USAGE_DAY_FORMAT),
        record
      )
    }

    const result = createListResult({
      title: `Leon Usage — ${period === undefined ? 'lifetime' : period === UsagePeriod.Week ? 'last 7 days' : period}`,
      tone: 'info',
      header: `Profile: ${getActiveProfileName()} · Time zone: ${timeZone}`,
      items: [
        { label: 'Total', value: formatUsage(total) },
        {
          label: 'Coverage',
          description: total.requests + total.historicalTurns === 0
            ? 'No requests recorded for this period.'
            : 'Live attempts include retries and background work. Historical turns contain saved totals with potentially partial counters; records refer to attempts or historical turns. Unavailable counters are not zero.'
        },
        {
          label: 'Accounting',
          description: 'Cached input is included in input; reasoning is included in output. Cost is provider-reported usage cost, not a subscription bill or remaining allowance.'
        }
      ]
    })
    const blocks = [
      { type: 'list' as const, header: 'Models and connections', items: groupItems(models) },
      { type: 'list' as const, header: 'Purposes', items: groupItems(purposes) },
      ...(period === UsagePeriod.Week
        ? [{ type: 'list' as const, header: 'Daily usage', items: groupItems(days) }]
        : [])
    ].filter((block) => block.items.length > 0)

    result.blocks.push(...blocks)
    result.plain_text = renderBuiltInCommandResult(result, 'terminal')

    return { status: 'completed', result }
  }
}
