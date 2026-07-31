import { LLMProviders } from '@/core/llm-manager/types'

import type { AgentPhase } from './types'

export interface RawPhaseMetric {
  outputTokens: number
  durationMs: number
}

export type RawPhaseMetrics = Record<AgentPhase, RawPhaseMetric>

export interface VisibleOutputParams {
  output?: unknown | undefined
  reasoning?: string | undefined
}

export interface VisibleOutputMetrics {
  text: string
  outputChars: number
  visibleOutputTokens: number
}

export interface FinalAnswerCaptureParams {
  requestStartedAt: number
  completedAt: number
  inputTokens: number
  outputTokens: number
  visibleOutputTokens?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  fallbackDecodeDurationMs: number
  firstTokenAt?: number | null
}

export interface FinalAnswerMetricsSnapshot {
  inputTokens: number
  ttftMs: number
  requestDurationMs: number
  finalAnswerDurationMs: number
  outputTokens: number
  visibleOutputTokens?: number
  providerTokensPerSecond?: number
}

export interface PhaseMetricSnapshot extends RawPhaseMetric {
  tokensPerSecond: number
}

export type PhaseMetricSnapshots = Record<AgentPhase, PhaseMetricSnapshot>

export interface DerivedLLMMetrics {
  completionCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  finalAnswerDurationMs: number
  finalAnswerInputTokens: number
  finalAnswerOutputTokens: number
  finalAnswerTokensPerSecond: number
  finalAnswerCharsPerSecond: number
  outputCharsPerSecond: number
  averagedPhaseTokensPerSecond: number
  phaseMetrics: PhaseMetricSnapshots
  turnInputTokens: number
  turnOutputTokens: number
  turnTotalTokens: number
  ttftMs: number
  tokensPerSecond: number
}

export interface AccumulatedLLMMetricsState {
  completionCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalVisibleOutputTokens: number
  totalOutputChars: number
  totalGenerationDurationMs: number
  phaseMetrics: RawPhaseMetrics
  finalAnswerMetrics: FinalAnswerMetricsSnapshot | null
}

export interface MeasureVisibleOutputOptions {
  estimateTokensFromText: (text: string) => number
  tokenizeLocally?: ((text: string) => number) | undefined
}

interface DeriveLLMMetricsOptions extends MeasureVisibleOutputOptions {
  completionCount: number
  providerName: LLMProviders
  normalizedOutput: string
  totalInputTokens: number
  totalOutputTokens: number
  totalVisibleOutputTokens: number
  totalOutputChars: number
  totalGenerationDurationMs: number
  turnDurationMs: number
  phaseMetrics: RawPhaseMetrics
  finalAnswerMetrics: FinalAnswerMetricsSnapshot | null
}

export interface RecordCompletionMetricsParams {
  phase: AgentPhase
  usedInputTokens?: number | undefined
  usedOutputTokens?: number | undefined
  visibleOutputTokens?: number | undefined
  requestDurationMs?: number | undefined
  generationDurationMs?: number | undefined
  outputChars?: number | undefined
}

export interface ObserveCompletionMetricsOptions
  extends MeasureVisibleOutputOptions {
  providerName: LLMProviders
  accumulator: AccumulatedLLMMetricsState
  phase: AgentPhase
  completionStartedAt: number
  completedAt: number
  output?: unknown | undefined
  reasoning?: string | undefined
  usedInputTokens?: number | undefined
  usedOutputTokens?: number | undefined
  generationDurationMs?: number | undefined
  providerDecodeDurationMs?: number | undefined
  providerTokensPerSecond?: number | undefined
  firstTokenAt?: number | null | undefined
}

export interface CompletionObservationResult {
  accumulator: AccumulatedLLMMetricsState
  outputMetrics: Pick<VisibleOutputMetrics, 'outputChars' | 'visibleOutputTokens'>
  requestDurationMs: number
}

function perSecond(units: number, durationMs: number): number {
  return durationMs > 0 ? Number(((units / durationMs) * 1_000).toFixed(2)) : 0
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function buildVisibleOutputText(params: VisibleOutputParams): string {
  const parts: string[] = []

  if (params.reasoning?.trim()) {
    parts.push(params.reasoning)
  }

  if (typeof params.output === 'string') {
    if (params.output.trim()) {
      parts.push(params.output)
    }
  } else if (params.output !== undefined && params.output !== null) {
    parts.push(safeJSONStringify(params.output))
  }

  return parts.join('\n')
}

export function measureVisibleOutput(
  params: VisibleOutputParams,
  options: MeasureVisibleOutputOptions
): VisibleOutputMetrics {
  const text = buildVisibleOutputText(params)

  if (!text) {
    return {
      text: '',
      outputChars: 0,
      visibleOutputTokens: 0
    }
  }

  return {
    text,
    outputChars: text.length,
    visibleOutputTokens: options.tokenizeLocally
      ? options.tokenizeLocally(text)
      : options.estimateTokensFromText(text)
  }
}

export function measureOutputMetrics(
  params: VisibleOutputParams,
  options: MeasureVisibleOutputOptions
): Pick<VisibleOutputMetrics, 'outputChars' | 'visibleOutputTokens'> {
  const metrics = measureVisibleOutput(params, options)

  return {
    outputChars: metrics.outputChars,
    visibleOutputTokens: metrics.visibleOutputTokens
  }
}

export function recordCompletionMetrics(
  accumulator: AccumulatedLLMMetricsState,
  params: RecordCompletionMetricsParams
): AccumulatedLLMMetricsState {
  return {
    completionCount: accumulator.completionCount + 1,
    totalInputTokens: accumulator.totalInputTokens + (params.usedInputTokens ?? 0),
    totalOutputTokens:
      accumulator.totalOutputTokens + (params.usedOutputTokens ?? 0),
    totalVisibleOutputTokens:
      accumulator.totalVisibleOutputTokens + (params.visibleOutputTokens ?? 0),
    totalOutputChars: accumulator.totalOutputChars + (params.outputChars ?? 0),
    totalGenerationDurationMs:
      accumulator.totalGenerationDurationMs + (params.generationDurationMs ?? 0),
    phaseMetrics: {
      ...accumulator.phaseMetrics,
      [params.phase]: {
        outputTokens:
          accumulator.phaseMetrics[params.phase].outputTokens +
          (params.usedOutputTokens ?? 0),
        durationMs:
          accumulator.phaseMetrics[params.phase].durationMs +
          (params.requestDurationMs ?? 0)
      }
    },
    finalAnswerMetrics: accumulator.finalAnswerMetrics
  }
}

export function observeCompletionMetrics(
  options: ObserveCompletionMetricsOptions
): CompletionObservationResult {
  const outputMetrics = measureOutputMetrics(
    {
      output: options.output,
      reasoning: options.reasoning
    },
    options
  )
  const requestDurationMs = Math.max(
    options.completedAt - options.completionStartedAt,
    0
  )
  let accumulator = recordCompletionMetrics(options.accumulator, {
    phase: options.phase,
    usedInputTokens: options.usedInputTokens,
    usedOutputTokens: options.usedOutputTokens,
    visibleOutputTokens: outputMetrics.visibleOutputTokens,
    requestDurationMs,
    generationDurationMs: options.generationDurationMs,
    outputChars: outputMetrics.outputChars
  })

  if (options.phase === 'final_answer') {
    accumulator = {
      ...accumulator,
      finalAnswerMetrics: captureFinalAnswerMetrics(options.providerName, {
        requestStartedAt: options.completionStartedAt,
        completedAt: options.completedAt,
        inputTokens: options.usedInputTokens ?? 0,
        outputTokens: options.usedOutputTokens ?? 0,
        visibleOutputTokens: outputMetrics.visibleOutputTokens,
        ...(options.providerDecodeDurationMs
          ? { providerDecodeDurationMs: options.providerDecodeDurationMs }
          : {}),
        ...(options.providerTokensPerSecond
          ? { providerTokensPerSecond: options.providerTokensPerSecond }
          : {}),
        fallbackDecodeDurationMs: options.generationDurationMs ?? 0,
        ...(options.firstTokenAt ? { firstTokenAt: options.firstTokenAt } : {})
      })
    }
  }

  return {
    accumulator,
    outputMetrics,
    requestDurationMs
  }
}

export function captureFinalAnswerMetrics(
  providerName: LLMProviders,
  params: FinalAnswerCaptureParams
): FinalAnswerMetricsSnapshot {
  const ttftMs = params.firstTokenAt
    ? Math.max(params.firstTokenAt - params.requestStartedAt, 0)
    : 0
  const requestDurationMs = Math.max(
    params.completedAt - params.requestStartedAt,
    0
  )
  const streamedDecodeDurationMs =
    params.firstTokenAt && params.completedAt >= params.firstTokenAt
      ? Math.max(params.completedAt - params.firstTokenAt, 0)
      : 0
  const finalAnswerDurationMs =
    providerName === LLMProviders.LlamaCPP &&
    params.providerDecodeDurationMs &&
    params.providerDecodeDurationMs > 0
      ? params.providerDecodeDurationMs
      : params.fallbackDecodeDurationMs > 0
          ? params.fallbackDecodeDurationMs
          : streamedDecodeDurationMs > 0
            ? streamedDecodeDurationMs
            : requestDurationMs

  return {
    inputTokens: params.inputTokens,
    ttftMs,
    requestDurationMs,
    finalAnswerDurationMs,
    outputTokens: params.outputTokens,
    ...(params.visibleOutputTokens
      ? { visibleOutputTokens: params.visibleOutputTokens }
      : {}),
    ...(params.providerTokensPerSecond
      ? { providerTokensPerSecond: params.providerTokensPerSecond }
      : {})
  }
}

function createPhaseMetricSnapshots(
  phaseMetrics: RawPhaseMetrics
): PhaseMetricSnapshots {
  return {
    agent: {
      outputTokens: phaseMetrics.agent.outputTokens,
      durationMs: phaseMetrics.agent.durationMs,
      tokensPerSecond: perSecond(
        phaseMetrics.agent.outputTokens,
        phaseMetrics.agent.durationMs
      )
    },
    final_answer: {
      outputTokens: phaseMetrics.final_answer.outputTokens,
      durationMs: phaseMetrics.final_answer.durationMs,
      tokensPerSecond: perSecond(
        phaseMetrics.final_answer.outputTokens,
        phaseMetrics.final_answer.durationMs
      )
    }
  }
}

function averagePhaseTokensPerSecond(
  phaseMetrics: PhaseMetricSnapshots
): number {
  const activePhaseMetrics = Object.values(phaseMetrics).filter(
    (phaseMetric) => phaseMetric.durationMs > 0 && phaseMetric.outputTokens > 0
  )

  if (activePhaseMetrics.length === 0) {
    return 0
  }

  return Number(
    (
      activePhaseMetrics.reduce(
        (sum, phaseMetric) =>
          sum + phaseMetric.tokensPerSecond * phaseMetric.durationMs,
        0
      ) /
      activePhaseMetrics.reduce(
        (sum, phaseMetric) => sum + phaseMetric.durationMs,
        0
      )
    ).toFixed(2)
  )
}

function resolveFinalAnswerOutputTokens(
  providerName: LLMProviders,
  normalizedOutput: string,
  finalAnswerMetrics: FinalAnswerMetricsSnapshot | null,
  options: MeasureVisibleOutputOptions
): number {
  const providerOutputTokens = finalAnswerMetrics?.outputTokens ?? 0
  const visibleOutputTokens = finalAnswerMetrics?.visibleOutputTokens ?? 0

  if (providerName !== LLMProviders.LlamaCPP && visibleOutputTokens > 0) {
    return visibleOutputTokens
  }

  if (providerOutputTokens > 0) {
    return providerOutputTokens
  }

  return options.estimateTokensFromText(normalizedOutput)
}

function selectTokensPerSecond(params: {
  providerName: LLMProviders
  providerTokensPerSecond: number
  finalAnswerRequestTokensPerSecond: number
  finalAnswerTokensPerSecond: number
  measuredVisibleTurnTokensPerSecond: number
  measuredTurnTokensPerSecond: number
  averagedPhaseTokensPerSecond: number
}): number {
  if (
    params.providerName === LLMProviders.LlamaCPP &&
    params.providerTokensPerSecond > 0
  ) {
    return params.providerTokensPerSecond
  }

  if (
    params.providerName !== LLMProviders.LlamaCPP &&
    params.finalAnswerRequestTokensPerSecond > 0
  ) {
    return params.finalAnswerRequestTokensPerSecond
  }

  if (params.finalAnswerTokensPerSecond > 0) {
    return params.finalAnswerTokensPerSecond
  }

  if (params.measuredVisibleTurnTokensPerSecond > 0) {
    return params.measuredVisibleTurnTokensPerSecond
  }

  if (params.measuredTurnTokensPerSecond > 0) {
    return params.measuredTurnTokensPerSecond
  }

  return params.averagedPhaseTokensPerSecond
}

export function deriveLLMMetrics(
  options: DeriveLLMMetricsOptions
): DerivedLLMMetrics {
  const phaseMetrics = createPhaseMetricSnapshots(options.phaseMetrics)
  const averagedPhaseTokensPerSecond =
    averagePhaseTokensPerSecond(phaseMetrics)
  const totalGenerationDurationMs = Math.max(options.totalGenerationDurationMs, 0)
  const finalAnswerDurationMs =
    options.finalAnswerMetrics?.finalAnswerDurationMs ?? totalGenerationDurationMs
  const finalAnswerRequestDurationMs =
    options.finalAnswerMetrics?.requestDurationMs ?? finalAnswerDurationMs
  const ttftMs = options.finalAnswerMetrics?.ttftMs ?? 0
  const finalAnswerInputTokens =
    (options.finalAnswerMetrics?.inputTokens ?? 0) > 0
      ? (options.finalAnswerMetrics?.inputTokens as number)
      : options.totalInputTokens
  const finalAnswerOutputTokens = resolveFinalAnswerOutputTokens(
    options.providerName,
    options.normalizedOutput,
    options.finalAnswerMetrics,
    options
  )
  const finalAnswerTokensPerSecond = perSecond(
    finalAnswerOutputTokens,
    finalAnswerDurationMs
  )
  const finalAnswerRequestTokensPerSecond = perSecond(
    finalAnswerOutputTokens,
    finalAnswerRequestDurationMs
  )
  const finalAnswerCharsPerSecond = perSecond(
    options.normalizedOutput.length,
    finalAnswerDurationMs
  )
  const measuredTurnTokensPerSecond = perSecond(
    options.totalOutputTokens,
    totalGenerationDurationMs
  )
  const measuredVisibleTurnTokensPerSecond = perSecond(
    options.totalVisibleOutputTokens,
    totalGenerationDurationMs
  )
  const outputCharsPerSecond = perSecond(
    options.totalOutputChars,
    options.turnDurationMs
  )
  const tokensPerSecond = selectTokensPerSecond({
    providerName: options.providerName,
    providerTokensPerSecond:
      options.finalAnswerMetrics?.providerTokensPerSecond ?? 0,
    finalAnswerRequestTokensPerSecond,
    finalAnswerTokensPerSecond,
    measuredVisibleTurnTokensPerSecond,
    measuredTurnTokensPerSecond,
    averagedPhaseTokensPerSecond
  })
  return {
    completionCount: options.completionCount,
    inputTokens: options.totalInputTokens,
    outputTokens: options.totalOutputTokens,
    totalTokens: options.totalInputTokens + options.totalOutputTokens,
    durationMs: options.turnDurationMs,
    finalAnswerDurationMs,
    finalAnswerInputTokens,
    finalAnswerOutputTokens,
    finalAnswerTokensPerSecond,
    finalAnswerCharsPerSecond,
    outputCharsPerSecond,
    averagedPhaseTokensPerSecond,
    phaseMetrics,
    turnInputTokens: options.totalInputTokens,
    turnOutputTokens: options.totalOutputTokens,
    turnTotalTokens: options.totalInputTokens + options.totalOutputTokens,
    ttftMs,
    tokensPerSecond
  }
}
