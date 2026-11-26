import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { execa } from 'execa'
import YAML from 'yaml'

import type { AgentCompletionReviewDecision } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import { readInferenceUsage, type InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { TurnStage } from '@/core/turn-lifecycle/observability/timing-contract'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { runMaintainedTurn } from '../../test/agent/scenarios/scenario-fixture'
import { stopScenarioProcesses, withAgentScenarioHome } from '../../test/agent/scenario-home'

const MODEL = 'deepseek-flash'
const PROVIDER = 'deepseek'
const MODEL_TARGET = `${PROVIDER}/${MODEL}`
const REASONING = 'high'
const PROMPT_ECONOMY_SUITE = 'context-scenarios/prompt-economy-scenarios'
const CASES = [
  { name: 'selected-lookup', suite: PROMPT_ECONOMY_SUITE, turns: 1, callAllowance: 0 },
  { name: 'research-approval', suite: PROMPT_ECONOMY_SUITE, turns: 2, callAllowance: 1 },
  { name: 'search-follow-up', suite: 'tool-runtime-scenarios/tool-result-reuse-scenarios', turns: 2, callAllowance: 1 },
  { name: 'targeted-edit', suite: 'capability-scenarios/file-operations-scenarios', turns: 1, callAllowance: 1 },
  { name: 'explicit-recall', suite: 'memory-scenarios/persistence-scenarios', turns: 2, callAllowance: 1 },
  { name: 'noisy-command', suite: PROMPT_ECONOMY_SUITE, turns: 1, callAllowance: 1 }
] as const
const MAX_CONCURRENT_CASES = 3
const DEFAULT_MAX_GROWTH = 15
const CALIBRATION_SAMPLES = 3
const MAX_BUDGET_SAMPLES = 3
const BUDGET_VOTES_REQUIRED = 2
const INPUT_BUDGET_METRICS = ['inputTokens', 'peakInputTokens'] as const
const BUDGET_METRICS = [...INPUT_BUDGET_METRICS, 'modelCalls'] as const
const CASE_TIMEOUT_MS = 90_000
const RESULT_PREFIX = '__AGENT_RESULT__'
const PROGRESS_PREFIX = '__AGENT_PROGRESS__'
const MAXIMUM_DIAGNOSTIC_LENGTH = 4_000
const BASELINE_PATH = 'scripts/ci/quick-evals-baseline.json'
const DEFAULT_REPORT_PATH = 'tmp/quick-evals/report.json'
const SUITE_INPUTS = [
  BASELINE_PATH, 'config.sample.yml', 'scripts/ci/quick-evals.ts',
  'test/agent/scenario-home.ts', 'test/agent/e2e/run-agent-provider-scenario.ts', 'test/agent/scenarios/scenario-fixture.ts',
  ...CASES.map(({ suite, name }) => `test/agent/scenarios/${suite}/${name}.scenario.ts`)
]

interface Metrics {
  inputTokens: number
  cachedInputTokens: number
  uncachedInputTokens: number
  outputTokens: number
  peakInputTokens: number
  modelCalls: number
  failedCalls: number
  foregroundInputTokens: number
  maintenanceInputTokens: number
  turnLatencyMs: number
}

export interface Evaluation {
  metrics: Metrics
  turns: Array<Metrics & { toolCalls: number, firstToolInputMs?: number }>
  diagnostics: ScenarioDiagnostics
}

interface ScenarioDiagnostics {
  tools: string[]
  calls: Array<Pick<InferenceUsageRecord, 'purpose' | 'stage' | 'outcome'> &
    Pick<InferenceUsageRecord['usage'], 'inputTokens' | 'cachedInputTokens' | 'outputTokens'>>
  completionReviews: Array<AgentCompletionReviewDecision & { turn: number }>
}

interface FailedSample {
  reason: string
  exitCode?: number
  timedOut: boolean
  stderr?: string
  diagnostics: ScenarioDiagnostics
}

interface ScenarioChildResult {
  skipped: boolean
  reason?: string
  evidence?: Record<string, unknown>
}

interface Baseline {
  target: string
  reasoning: string
  cases: Record<string, Metrics>
}

type QuickEvalCase = (typeof CASES)[number]
type MaintainedTurn = Awaited<ReturnType<typeof runMaintainedTurn>>
type BudgetMetric = (typeof BUDGET_METRICS)[number]
type EvaluationSample = Evaluation & ReturnType<typeof compareQuickEval>
type ScenarioSample = { evaluation: Evaluation } | { failedSample: FailedSample }

interface EvaluationResult {
  samples: EvaluationSample[]
  actual?: Metrics
  failures: string[]
  warnings: string[]
  notes?: string[]
  failedSample?: FailedSample
}

/**
 * Measures every recorded request, including maintenance and failed attempts.
 * Successful calls must have all DeepSeek input and cache counters.
 */
export function summarizeQuickEvalUsage(
  rows: InferenceUsageRecord[],
  turnLatencyMs: number
): Metrics {
  assert(rows.length > 0, 'No provider usage was recorded')
  let inputTokens = 0
  let cachedInputTokens = 0
  let outputTokens = 0
  let peakInputTokens = 0
  let failedCalls = 0
  let maintenanceInputTokens = 0

  for (const row of rows) {
    assert.equal(row.provider, PROVIDER, 'Unexpected provider')
    assert.equal(row.model, MODEL, 'Unexpected model')
    const { inputTokens: input, cachedInputTokens: cached, outputTokens: output } = row.usage
    if (row.outcome === 'completed') {
      assert(Number.isSafeInteger(input) && input! > 0, 'Missing provider input usage')
      assert(Number.isSafeInteger(cached) && cached! >= 0 && cached! <= input!, 'Missing or invalid cache usage')
      assert(Number.isSafeInteger(output) && output! >= 0, 'Missing provider output usage')
    } else {
      failedCalls += 1
    }

    inputTokens += input ?? 0
    cachedInputTokens += cached ?? 0
    outputTokens += output ?? 0
    peakInputTokens = Math.max(peakInputTokens, input ?? 0)
    if (row.stage === TurnStage.PreTurn || row.stage === TurnStage.PostTurn) {
      maintenanceInputTokens += input ?? 0
    }
  }

  return {
    inputTokens, cachedInputTokens, uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens, peakInputTokens, modelCalls: rows.length, failedCalls,
    foregroundInputTokens: inputTokens - maintenanceInputTokens, maintenanceInputTokens,
    turnLatencyMs
  }
}

/**
 * Gates measured work and reports network-sensitive latency separately.
 */
export function compareQuickEval(
  observed: Metrics,
  baseline: Metrics,
  maxGrowth: number,
  callAllowance: number
): {
  failures: string[]
  budgetFailures: Partial<Record<BudgetMetric, string>>
  warnings: string[]
  uncachedWarning?: string
} {
  const budgetFailures: Partial<Record<BudgetMetric, string>> = {}
  const warnings: string[] = []

  for (const key of [...BUDGET_METRICS, 'turnLatencyMs'] as const) {
    assert(Number.isFinite(baseline[key]) && baseline[key] > 0, `Missing or invalid baseline ${key}`)
  }
  for (const key of INPUT_BUDGET_METRICS) {
    if (observed[key] * 100 > baseline[key] * (100 + maxGrowth)) {
      budgetFailures[key] = `${key} grew from ${baseline[key]} to ${observed[key]} (limit +${maxGrowth}%)`
    }
  }
  if (observed.modelCalls > baseline.modelCalls + callAllowance) {
    budgetFailures.modelCalls = `modelCalls grew from ${baseline.modelCalls} to ${observed.modelCalls} (limit +${callAllowance})`
  }
  if (observed.failedCalls) {
    warnings.push(`${observed.failedCalls} provider call(s) did not complete`)
  }
  const uncachedWarning = observed.uncachedInputTokens * 100 > baseline.uncachedInputTokens * (100 + maxGrowth)
    ? `uncachedInputTokens grew from ${baseline.uncachedInputTokens} to ${observed.uncachedInputTokens}`
    : undefined
  if (observed.turnLatencyMs > baseline.turnLatencyMs * (1 + maxGrowth / 100)) {
    warnings.push(`turnLatencyMs grew from ${baseline.turnLatencyMs} to ${observed.turnLatencyMs}`)
  }

  return {
    failures: Object.values(budgetFailures), budgetFailures, warnings,
    ...(uncachedWarning ? { uncachedWarning } : {})
  }
}

function scenarioDiagnostics(lines: string[], rows: InferenceUsageRecord[]): ScenarioDiagnostics {
  const events = lines.filter((line) => line.startsWith(PROGRESS_PREFIX)).map((line) =>
    JSON.parse(line.slice(PROGRESS_PREFIX.length)) as {
      stage: string
      turn?: number
      data?: { toolName?: string, review?: AgentCompletionReviewDecision }
    }
  )
  const tools = events.flatMap(({ stage, data }) =>
    stage === 'tool_call' && data?.toolName ? [data.toolName] : []
  )
  const completionReviews = events.flatMap(({ stage, turn, data }) => {
    if (stage !== 'completion_review' || turn === undefined || !data?.review) {
      return []
    }

    const { intent, verdict, revisionRequested } = data.review

    return [{ turn, intent, verdict, revisionRequested }]
  })
  const calls = rows.map(({ purpose, stage, outcome, usage: { inputTokens, cachedInputTokens, outputTokens } }) => ({
    purpose, stage, outcome, inputTokens, cachedInputTokens, outputTokens
  }))

  return { tools, calls, completionReviews }
}

function redactDiagnostic(text: string): string {
  // GitHub's console masking does not apply to uploaded files.
  const apiKey = process.env['LEON_DEEPSEEK_API_KEY']

  return apiKey ? text.replaceAll(apiKey, '[redacted]') : text
}

/**
 * Runs an existing quality-asserting scenario without loading any owner state.
 */
async function runCase(scenario: QuickEvalCase, jqPath: string): Promise<ScenarioSample> {
  return withAgentScenarioHome(async (home) => {
    const configPath = path.join(home, 'config.yml')
    const config = YAML.parseDocument(await fs.readFile('config.sample.yml', 'utf8'))
    config.setIn(['runtime', 'pulse_enabled'], false)
    config.setIn(['llm', 'model_settings', MODEL_TARGET, 'reasoning'], REASONING)
    config.setIn(['telemetry_enabled'], false)
    await fs.writeFile(configPath, String(config), { mode: 0o600 })

    const child = execa(process.execPath, [
      '--import', 'tsx', 'test/agent/e2e/run-agent-provider-scenario.ts',
      PROVIDER, `${scenario.suite}/${scenario.name}`, '--real-scenario', '--runtime', 'tool'
    ], {
      all: true, reject: false, timeout: CASE_TIMEOUT_MS, detached: process.platform !== 'win32',
      env: {
        LEON_NODE_ENV: 'testing',
        LEON_AGENT_SCENARIO_HOME: home,
        LEON_AGENT_E2E_SOURCE_CONFIG_PATH: configPath,
        LEON_AGENT_E2E_SOURCE_JQ_PATH: jqPath,
        LEON_AGENT_SCENARIO_TARGET: MODEL_TARGET
      }
    })

    try {
      const run = await child
      const lines = run.all?.split('\n') ?? []
      const line = lines.findLast((entry) => entry.startsWith(RESULT_PREFIX))
      const result = line ? JSON.parse(line.slice(RESULT_PREFIX.length)) as ScenarioChildResult : undefined
      const profilesDirectory = path.join(home, 'profiles')
      const [profile] = await fs.readdir(profilesDirectory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return []
        }
        throw error
      })
      const rows: InferenceUsageRecord[] = []
      if (profile) {
        for await (const row of readInferenceUsage({}, {
          ...getProfilePaths(profile), logs: path.join(profilesDirectory, profile, 'logs')
        })) {
          rows.push(row)
        }
      }
      const diagnostics = scenarioDiagnostics(lines, rows)
      if (run.exitCode !== 0 || !result || result.skipped) {
        const reason = result?.reason ?? (run.timedOut ? `Scenario timed out after ${CASE_TIMEOUT_MS / 1_000}s` :
          (run.failed ? run.shortMessage : undefined))
        const stderr = redactDiagnostic(run.stderr).trim().slice(-MAXIMUM_DIAGNOSTIC_LENGTH)

        return { failedSample: {
          reason: redactDiagnostic(reason || 'No scenario result was produced').slice(0, MAXIMUM_DIAGNOSTIC_LENGTH),
          exitCode: run.exitCode, timedOut: run.timedOut, ...(stderr ? { stderr } : {}), diagnostics
        } }
      }

      const turns = Object.values(result.evidence ?? {}).filter((value): value is MaintainedTurn =>
        !!value && typeof value === 'object' && 'turnId' in value && typeof value.turnId === 'string'
      )
      const turnIds = new Set(turns.map((turn) => turn.turnId))
      assert(turns.length === scenario.turns && turnIds.size === scenario.turns, 'Unexpected turn count')
      const measuredRows = rows.filter((row) => row.turnId && turnIds.has(row.turnId))
      const measurements = turns.map((turn) => {
        const duration = turn.responseTrace.metrics?.durationMs
        assert(typeof duration === 'number' && duration > 0, 'Missing turn latency')
        const firstToolInputMs = turn.responseTrace.inferences?.find((entry) =>
          entry.firstToolInputMs !== undefined
        )?.firstToolInputMs

        return {
          ...summarizeQuickEvalUsage(measuredRows.filter((row) =>
            row.turnId === turn.turnId && row.sessionId === turn.sessionId
          ), duration),
          toolCalls: turn.toolCalls.length,
          ...(firstToolInputMs === undefined ? {} : { firstToolInputMs })
        }
      })
      assert.equal(measurements.reduce((total, turn) => total + turn.modelCalls, 0),
        measuredRows.length, 'Unexpected inference session attribution')

      return { evaluation: {
        metrics: summarizeQuickEvalUsage(measuredRows, measurements.reduce((total, turn) => total + turn.turnLatencyMs, 0)),
        turns: measurements, diagnostics
      } }
    } finally {
      stopScenarioProcesses(child.pid)
    }
  })
}

/**
 * Uses a fresh batch to confirm repeated usage breaches in the affected scenario.
 * Scenario failures stop sampling immediately because every attempt must satisfy its assertions.
 */
export async function evaluateQuickEvalCase(
  runSample: () => Promise<ScenarioSample>,
  maxGrowth: number,
  callAllowance: number,
  baseline?: Metrics
): Promise<EvaluationResult> {
  const samples: EvaluationSample[] = []

  try {
    let sampleLimit = baseline ? 1 : CALIBRATION_SAMPLES
    let budgetsToConfirm: BudgetMetric[] = []

    for (let index = 0; index < sampleLimit; index += 1) {
      const attempt = await runSample()
      if ('failedSample' in attempt) {
        const { failedSample } = attempt
        return { samples, failures: [failedSample.reason], warnings: [], failedSample }
      }

      const sample = attempt.evaluation
      const comparison = baseline
        ? compareQuickEval(sample.metrics, baseline, maxGrowth, callAllowance)
        : { failures: [], budgetFailures: {}, warnings: [] }
      samples.push({ ...sample, ...comparison })

      if (baseline && samples.length === 1 && (comparison.failures.length || comparison.uncachedWarning)) {
        sampleLimit = MAX_BUDGET_SAMPLES
      }
      if (baseline && samples.length === MAX_BUDGET_SAMPLES) {
        // Count each budget independently so unrelated spikes cannot confirm one another.
        budgetsToConfirm = BUDGET_METRICS.filter((metric) =>
          samples.filter(({ budgetFailures }) => budgetFailures[metric]).length >= BUDGET_VOTES_REQUIRED
        )
        if (budgetsToConfirm.length) {
          sampleLimit += MAX_BUDGET_SAMPLES
        }
      }
    }

    // Keep the original batch as the summary measurement and retain both batches in the report.
    const initialSamples = baseline ? samples.slice(0, MAX_BUDGET_SAMPLES) : samples
    const confirmationSamples = samples.slice(initialSamples.length)
    const uncachedBreaches = initialSamples.filter(({ uncachedWarning }) => uncachedWarning).length
    const notes: string[] = []
    let representative = initialSamples.at(-1)!

    if (!baseline || uncachedBreaches) {
      const key = baseline ? 'uncachedInputTokens' : 'inputTokens'
      const ranked = initialSamples.toSorted((left, right) => left.metrics[key] - right.metrics[key])
      representative = ranked[Math.floor(ranked.length / 2)]!
      if (uncachedBreaches) {
        const [first] = ranked
        const last = ranked.at(-1)!
        notes.push(`Uncached input median ${representative.metrics[key]} tokens, range ${first!.metrics[key]}–${last.metrics[key]} (${uncachedBreaches}/${initialSamples.length} above +${maxGrowth}%)`)
      }
    }

    const failures: string[] = []
    const warnings = [...representative.warnings]

    for (const metric of budgetsToConfirm) {
      const initialVotes = initialSamples.filter(({ budgetFailures }) => budgetFailures[metric]).length
      const breaches = confirmationSamples.flatMap(({ budgetFailures }) => budgetFailures[metric] ?? [])

      notes.push(`${metric} exceeded its budget in ${initialVotes}/${initialSamples.length} initial samples and ${breaches.length}/${confirmationSamples.length} confirmation samples`)
      if (breaches.length >= BUDGET_VOTES_REQUIRED) {
        failures.push(...new Set(breaches))
      } else {
        warnings.push(`${metric} budget breach was inconclusive`)
      }
    }
    if (!budgetsToConfirm.length && initialSamples.some(({ failures }) => failures.length)) {
      warnings.push('Initial samples showed isolated budget breaches')
    }
    if (uncachedBreaches >= BUDGET_VOTES_REQUIRED) {
      warnings.push('Uncached input growth persisted across samples')
    }

    return { samples, actual: representative.metrics, failures, warnings, ...(notes.length ? { notes } : {}) }
  } catch (error) {
    const reason = error instanceof Error ? redactDiagnostic(error.message) : 'Scenario failed'

    return { samples, failures: [reason], warnings: [] }
  }
}

async function main(): Promise<void> {
  const startedAt = performance.now()
  const recordedAt = Date.now()
  const sha = process.env['GITHUB_SHA'] || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const committedAt = Number(execFileSync('git', ['show', '-s', '--format=%ct', sha], { encoding: 'utf8' }).trim()) * 1_000
  const version = (JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string }).version
  const suite = createHash('sha256')
  const suiteFiles = await Promise.all(SUITE_INPUTS.map((filename) => fs.readFile(filename)))
  for (const [index, contents] of suiteFiles.entries()) {
    suite.update(JSON.stringify([SUITE_INPUTS[index], createHash('sha256').update(contents).digest('hex')]))
  }
  const calibrate = process.argv.includes('--calibrate')
  const maxGrowth = Number(process.env['LEON_EVAL_MAX_GROWTH_PERCENT']?.trim() || DEFAULT_MAX_GROWTH)
  assert(process.env['LEON_DEEPSEEK_API_KEY'], 'LEON_DEEPSEEK_API_KEY is required')
  assert(Number.isFinite(maxGrowth) && maxGrowth >= 0 && maxGrowth <= 100, 'Growth percent must be between 0 and 100')
  const jqPath = process.env['LEON_JQ_PATH'] || execFileSync('which', ['jq'], { encoding: 'utf8' }).trim()
  const baseline = calibrate ? undefined : JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8')) as Baseline
  if (baseline) {
    assert.equal(baseline.target, MODEL_TARGET)
    assert.equal(baseline.reasoning, REASONING)
    for (const { name } of CASES) {
      assert(baseline.cases[name], `Missing baseline for ${name}`)
    }
  }
  const collected: Baseline = { target: MODEL_TARGET, reasoning: REASONING, cases: {} }
  const results: Array<Record<string, unknown>> = []
  const findings: string[] = []
  const summary = [
    '## Leon Quick Evals',
    '',
    `Model \`${MODEL_TARGET}\` · reasoning ${REASONING} · input threshold +${maxGrowth}%`,
    '',
    '| Scenario | Input | Cached | Uncached | Peak input | Calls | Turn latency | Result |',
    '|---|---:|---:|---:|---:|---:|---:|---|'
  ]
  const pending = CASES.entries()
  const evaluated: Array<EvaluationResult & {
    scenario: string
    expected: Metrics | undefined
  }> = []
  // Cases have independent profiles. Let free workers pick up another case
  // while keeping parallel live requests bounded.
  await Promise.all(Array.from({ length: MAX_CONCURRENT_CASES }, async () => {
    for (const [index, scenario] of pending) {
      const expected = baseline?.cases[scenario.name]
      const outcome = await evaluateQuickEvalCase(() => runCase(scenario, jqPath), maxGrowth, scenario.callAllowance, expected)
      evaluated[index] = { scenario: scenario.name, expected, ...outcome }
    }
  }))

  for (const { scenario, expected, actual, samples, failures, warnings, notes, failedSample } of evaluated) {
    if (failures.length) {
      process.exitCode = 1
    }
    if (calibrate && actual) {
      collected.cases[scenario] = actual
    }
    const status = failures.length ? 'Failed' : warnings.length ? 'Warning' : 'Passed'
    const metricText = (key: keyof Metrics): string => {
      if (!actual) {
        return '—'
      }
      return expected ? `${expected[key]} → ${actual[key]}` : String(actual[key])
    }
    summary.push(`| ${scenario} | ${metricText('inputTokens')} | ${metricText('cachedInputTokens')} | ${metricText('uncachedInputTokens')} | ${metricText('peakInputTokens')} | ${metricText('modelCalls')} | ${actual ? `${metricText('turnLatencyMs')} ms` : '—'} | ${status} |`)
    for (const finding of [...failures, ...warnings, ...(notes ?? [])]) {
      findings.push(`- ${scenario} · ${finding.split('\n', 1)[0]}`)
    }
    results.push({ scenario, status, baseline: expected, measured: actual, samples, failures, warnings,
      ...(notes ? { notes } : {}), ...(failedSample ? { failedSample } : {}) })
  }
  const durationMs = Math.round(performance.now() - startedAt)
  const report = process.env['LEON_EVAL_REPORT'] || DEFAULT_REPORT_PATH
  await fs.mkdir(path.dirname(report), { recursive: true })
  await fs.writeFile(report, JSON.stringify({
    sha, version, recordedAt, committedAt, suiteRevision: suite.digest('hex'),
    model: MODEL_TARGET, reasoning: REASONING, maxGrowth, durationMs, results,
    ...(calibrate && !process.exitCode ? { proposedBaseline: collected } : {})
  }, null, 2) + '\n')
  const markdown = [...summary, '', `Suite wall time ${(durationMs / 1_000).toFixed(1)} s`,
    ...(findings.length ? ['', ...findings] : [])].join('\n') + '\n'
  console.log(markdown)
  if (process.env['GITHUB_STEP_SUMMARY']) {
    await fs.appendFile(process.env['GITHUB_STEP_SUMMARY'], markdown)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Quick Evals failed')
    process.exitCode = 1
  })
}
