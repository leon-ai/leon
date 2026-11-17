import { Progress } from '../../../../../aurora/src/v2/components/progress'
import { formatBytes } from '../../../../../aurora/src/v2/utils/format-bytes'
import type { UpdateState } from '../../../../../bridges/runtime/contracts/updates'

import { UPDATE_STAGE_LABELS } from '../../../../../bridges/runtime/contracts/update-status.js'

const STAGE_LABELS: Record<string, string> = UPDATE_STAGE_LABELS

/**
 * Renders actual host receipts. Only measured work gets a percentage; other
 * stages retain an indeterminate loader and bounded, expandable details.
 */
export function UpdateProgress({ state }: { state: UpdateState }) {
  const steps = state.steps?.length ? state.steps : state.progress ? [{
    id: state.progress.phase, status: 'running', details: [],
    downloadedBytes: state.progress.downloadedBytes, totalBytes: state.progress.totalBytes
  }] : []

  return <ol className="update-steps" aria-label="Core update progress">
    {steps.map((step, index) => <li key={step.id} data-status={step.status}>
      <div className="update-step-heading"><span className="update-step-marker" aria-hidden="true">{step.status === 'completed' ? '✓' : index + 1}</span>
        <strong>{STAGE_LABELS[step.id] ?? 'Updating my Core'}</strong>
        <span>{step.status === 'completed' ? 'Complete' : step.status === 'failed' ? 'Failed' : 'In progress'}</span></div>
      <div className="update-step-content">
      {step.status === 'running' && <Progress label={STAGE_LABELS[step.id] ?? 'Updating my Core'} showLabel={false}
        {...(step.downloadedBytes !== null && step.totalBytes !== null && step.totalBytes > 0
          ? { value: step.downloadedBytes, max: step.totalBytes } : {})} />}
      {step.downloadedBytes !== null && step.totalBytes !== null && <p>{formatBytes(step.downloadedBytes)} / {formatBytes(step.totalBytes)}</p>}
      {step.details.length > 0 && <details><summary>Details</summary><ul>{step.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></details>}
      </div>
    </li>)}
    {state.error && <li role="alert">{state.error}</li>}
  </ol>
}
