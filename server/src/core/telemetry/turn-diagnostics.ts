import type { CompletedOwnerTurn } from '@/core/turn-lifecycle/observability/timing'
import { TurnPhase, TurnStage } from '@/core/turn-lifecycle/observability/timing-contract'

import { getPublicModel, TELEMETRY_MAX_TURN_FAILURES, type TurnDiagnostic } from './report-contract'

/**
 * Preserves one terminal outcome and groups failed attempts by fixed reason and public model.
 */
export function summarizeTurnDiagnostics(turn: CompletedOwnerTurn): TurnDiagnostic[] {
  const { outcome, terminal } = turn.measurement
  const diagnostics = new Map<string, TurnDiagnostic>()
  if (outcome === 'blocked' || outcome === 'failed') {
    diagnostics.set('terminal', {
      kind: 'terminal', count: 1,
      phase: terminal?.phase ?? TurnPhase.Execution,
      code: terminal?.code ?? (outcome === 'blocked' ? 'blocked' : turn.measurement.failure ?? 'unknown'),
      ...(terminal?.inference ? { inference: terminal.inference } : {}),
      ...(terminal?.diagnosticId ? { diagnosticId: terminal.diagnosticId } : {})
    })
  }

  const addAttempt = (entry: Omit<TurnDiagnostic, 'kind'>): void => {
    const { phase, code, inference } = entry
    const key = JSON.stringify([phase, code, inference])
    const current = diagnostics.get(key)
    if (current) {
      current.count += entry.count
    } else if (diagnostics.size < TELEMETRY_MAX_TURN_FAILURES) {
      diagnostics.set(key, { kind: 'attempt', ...entry })
    }
  }

  for (const attempt of turn.attemptFailures ?? []) {
    addAttempt(attempt)
  }
  for (const timing of turn.timings) {
    if (timing.stage !== TurnStage.AgentLoop || timing.kind !== 'inference' || !timing.failureCode) {
      continue
    }
    const phase = timing.goal === TurnPhase.Review || timing.goal === TurnPhase.Compaction ||
      timing.goal === TurnPhase.Context || timing.goal === TurnPhase.Answer ? timing.goal : TurnPhase.Request
    const inference = timing.provider && timing.model ? getPublicModel(timing.provider, timing.model) : undefined
    addAttempt({ phase, code: timing.failureCode, count: 1, ...(inference ? { inference } : {}) })
  }

  return [...diagnostics.values()]
}
