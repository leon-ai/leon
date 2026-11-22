import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { execa } from 'execa'
import YAML from 'yaml'

import { readInferenceUsage, type InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { TurnStage } from '@/core/llm-manager/turn-timing-contract'
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
const CASE_TIMEOUT_MS = 90_000
const RESULT_PREFIX = '__AGENT_RESULT__'
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

interface Evaluation {
  metrics: Metrics
  turns: Array<Metrics & { toolCalls: number, firstToolInputMs?: number }>
}

interface Baseline {
  target: string
  reasoning: string
  cases: Record<string, Metrics>
}

type QuickEvalCase = (typeof CASES)[number]
type MaintainedTurn = Awaited<ReturnType<typeof runMaintainedTurn>>
type EvaluationSample = Evaluation & ReturnType<typeof compareQuickEval>

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
): { failures: string[], warnings: string[] } {
  const failures: string[] = []
  const warnings: string[] = []
  for (const key of ['inputTokens', 'peakInputTokens', 'modelCalls', 'turnLatencyMs'] as const) {
    assert(Number.isFinite(baseline[key]) && baseline[key] > 0, `Missing or invalid baseline ${key}`)
  }
  for (const key of ['inputTokens', 'peakInputTokens'] as const) {
    if (observed[key] * 100 > baseline[key] * (100 + maxGrowth)) {
      failures.push(`${key} grew from ${baseline[key]} to ${observed[key]} (limit +${maxGrowth}%)`)
    }
  }
  if (observed.modelCalls > baseline.modelCalls + callAllowance) {
    failures.push(`modelCalls grew from ${baseline.modelCalls} to ${observed.modelCalls} (limit +${callAllowance})`)
  }
  if (observed.failedCalls) {
    warnings.push(`${observed.failedCalls} provider call(s) did not complete`)
  }
  if (observed.uncachedInputTokens * 100 > baseline.uncachedInputTokens * (100 + maxGrowth)) {
    warnings.push(`uncachedInputTokens grew from ${baseline.uncachedInputTokens} to ${observed.uncachedInputTokens}`)
  }
  if (observed.turnLatencyMs > baseline.turnLatencyMs * (1 + maxGrowth / 100)) {
    warnings.push(`turnLatencyMs grew from ${baseline.turnLatencyMs} to ${observed.turnLatencyMs}`)
  }

  return { failures, warnings }
}

/**
 * Runs an existing quality-asserting scenario without loading any owner state.
 */
async function runCase(scenario: QuickEvalCase, jqPath: string): Promise<Evaluation> {
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
      const line = run.all?.split('\n').findLast((entry) => entry.startsWith(RESULT_PREFIX))
      const result = line ? JSON.parse(line.slice(RESULT_PREFIX.length)) as {
        skipped: boolean
        evidence?: Record<string, unknown>
      } : undefined
      assert(run.exitCode === 0 && result && !result.skipped, `${scenario.name} did not pass its scenario assertions (${run.timedOut ? 'timeout' : 'child failed or skipped'})`)
      const turns = Object.values(result.evidence ?? {}).filter((value): value is MaintainedTurn =>
        !!value && typeof value === 'object' && 'turnId' in value && typeof value.turnId === 'string'
      )
      const turnIds = new Set(turns.map((turn) => turn.turnId))
      assert(turns.length === scenario.turns && turnIds.size === scenario.turns, 'Unexpected turn count')
      const [profile] = await fs.readdir(path.join(home, 'profiles'))
      assert(profile, 'Scenario profile not found')
      const paths = getProfilePaths(profile)
      const rows: InferenceUsageRecord[] = []
      for await (const row of readInferenceUsage({}, {
        ...paths, logs: path.join(home, 'profiles', profile, 'logs')
      })) {
        if (row.turnId && turnIds.has(row.turnId)) {
          rows.push(row)
        }
      }
      const measurements = turns.map((turn) => {
        const duration = turn.responseTrace.metrics?.durationMs
        assert(typeof duration === 'number' && duration > 0, 'Missing turn latency')
        const firstToolInputMs = turn.responseTrace.inferences?.find((entry) =>
          entry.firstToolInputMs !== undefined
        )?.firstToolInputMs

        return {
          ...summarizeQuickEvalUsage(rows.filter((row) =>
            row.turnId === turn.turnId && row.sessionId === turn.sessionId
          ), duration),
          toolCalls: turn.toolCalls.length,
          ...(firstToolInputMs === undefined ? {} : { firstToolInputMs })
        }
      })
      assert.equal(measurements.reduce((total, turn) => total + turn.modelCalls, 0),
        rows.length, 'Unexpected inference session attribution')

      return {
        metrics: summarizeQuickEvalUsage(rows, measurements.reduce((total, turn) => total + turn.turnLatencyMs, 0)),
        turns: measurements
      }
    } finally {
      stopScenarioProcesses(child.pid)
    }
  })
}

/**
 * Accepts a passing first sample and checks a budget breach for repeatability.
 */
async function evaluateCase(
  scenario: QuickEvalCase,
  jqPath: string,
  calibrate: boolean,
  maxGrowth: number,
  baseline?: Metrics
): Promise<{
  samples: EvaluationSample[]
  actual?: Metrics
  failures: string[]
  warnings: string[]
}> {
  const samples: EvaluationSample[] = []
  try {
    assert(calibrate || baseline, `Missing baseline for ${scenario.name}`)
    const sampleLimit = calibrate ? CALIBRATION_SAMPLES : MAX_BUDGET_SAMPLES
    let breaches = 0
    for (let index = 0; index < sampleLimit; index += 1) {
      const sample = await runCase(scenario, jqPath)
      const comparison = baseline
        ? compareQuickEval(sample.metrics, baseline, maxGrowth, scenario.callAllowance)
        : { failures: [], warnings: [] }
      samples.push({ ...sample, ...comparison })

      breaches += Number(comparison.failures.length > 0)
      if (!calibrate && (breaches === 0 || breaches >= BUDGET_VOTES_REQUIRED ||
        samples.length - breaches >= BUDGET_VOTES_REQUIRED)) {
        break
      }
    }

    let representative = samples.at(-1)!
    if (calibrate) {
      const ranked = samples.toSorted((left, right) => left.metrics.inputTokens - right.metrics.inputTokens)
      representative = ranked[Math.floor(ranked.length / 2)]!
    }
    const { metrics: actual, failures, warnings: sampleWarnings } = representative
    const warnings = [...sampleWarnings]
    if (!calibrate && !failures.length && samples.length > 1) {
      warnings.push('One sample exceeded the budget before two samples passed')
    }

    return { samples, actual, failures, warnings }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Scenario failed'
    console.error(`${scenario.name}: ${reason}`)
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
  const evaluated: Array<Awaited<ReturnType<typeof evaluateCase>> & {
    scenario: string
    expected: Metrics | undefined
  }> = []
  // Cases have independent profiles. Let free workers pick up another case
  // while keeping parallel live requests bounded.
  await Promise.all(Array.from({ length: MAX_CONCURRENT_CASES }, async () => {
    for (const [index, scenario] of pending) {
      const expected = baseline?.cases[scenario.name]
      const outcome = await evaluateCase(scenario, jqPath, calibrate, maxGrowth, expected)
      evaluated[index] = { scenario: scenario.name, expected, ...outcome }
    }
  }))

  for (const { scenario, expected, actual, samples, failures, warnings } of evaluated) {
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
    for (const finding of [...failures, ...warnings]) {
      findings.push(`- ${scenario} · ${finding}`)
    }
    results.push({ scenario, status, baseline: expected, measured: actual, samples, failures, warnings })
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
