import { UpdatePhase } from '../../bridges/runtime/contracts/update-status.js'

const MAXIMUM_DETAILS = 24
const MAXIMUM_DETAIL_CHARACTERS = 500

/**
 * Keeps bounded, public progress on the job receipt without exposing host paths
 * or subprocess output. Completed stages retain their measured download totals.
 * @param {import('../../bridges/runtime/contracts/updates').UpdateState} state
 * @param {string} stage
 * @param {{downloadedBytes?: number | null, totalBytes?: number | null, detail?: string}} [value]
 */
export function recordUpdateProgress(state, stage, value = {}) {
  state.steps ??= []
  for (const step of state.steps) {
    if (step.status === 'running' && step.id !== stage) {
      step.status = 'completed'
    }
  }
  let step = state.steps.find((item) => item.id === stage)
  if (!step) {
    step = { id: stage, status: 'running', downloadedBytes: null, totalBytes: null, details: [] }
    state.steps.push(step)
  }
  step.downloadedBytes = value.downloadedBytes ?? null
  step.totalBytes = value.totalBytes ?? null
  if (value.detail && step.details.at(-1) !== value.detail) {
    step.details.push(value.detail.slice(0, MAXIMUM_DETAIL_CHARACTERS))
    step.details.splice(0, Math.max(0, step.details.length - MAXIMUM_DETAILS))
  }
  state.progress = { phase: stage, downloadedBytes: step.downloadedBytes, totalBytes: step.totalBytes }
}

/**
 * Settles the last loader when the host confirms readiness or records failure.
 * @param {import('../../bridges/runtime/contracts/updates').UpdateState} state
 */
export function finishUpdateProgress(state) {
  for (const step of state.steps ?? []) {
    if (step.status === 'running') {
      step.status = state.phase === UpdatePhase.Failed ? 'failed' : 'completed'
    }
  }
  state.progress = null
}
