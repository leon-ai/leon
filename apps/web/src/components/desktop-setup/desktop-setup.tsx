import { Button } from '@/components/button'
import { Progress } from '../../../../../aurora/src/v2/components/progress'
import { formatBytes } from '../../../../../aurora/src/v2/utils/format-bytes'
import './desktop-setup.sass'

import { SetupPhase, type SetupState } from '../../../../../bridges/runtime/contracts/desktop-setup'

export { SetupPhase, type SetupState } from '../../../../../bridges/runtime/contracts/desktop-setup'

interface DesktopSetupViewProps {
  data: SetupState
  pending: boolean
  error?: string | null
  onStart: () => void
  onCancel: () => void
  onLogs: () => void
}

/**
 * Shows automatic server preparation and recovery, shared with Aurora previews.
 * Advanced lifecycle controls live in the native Server menu rather than onboarding.
 */
export function DesktopSetupView({ data, pending, error, onStart, onCancel, onLogs }: DesktopSetupViewProps) {
  const running = data.phase === SetupPhase.Running
  const ready = data.phase === SetupPhase.Complete
  return <main className="setup">
    <header><h1>{ready ? 'I’m ready' : 'I’m getting ready'}</h1>
      <p>I’ll open your session as soon as my server is ready.</p></header>
    <section aria-label="Installation">
      <div className="setup-actions">
        {!running && !ready && <>
          <Button variant="primary" disabled={pending} onClick={onStart}>
            Retry setup
          </Button>
        </>}
        {running && <Button variant="secondary" disabled={pending} onClick={onCancel}>Cancel setup</Button>}
      </div>
      {(data.error || error) && <p role="alert">{data.error ?? error}</p>}
      <ol className="setup-steps" aria-label="Setup progress">
        {data.steps.map((step) => <li key={step.id} className={`setup-step setup-step-${step.phase}`}>
          <div className="setup-step-heading">
            <span aria-hidden="true">{step.phase === SetupPhase.Complete ? '✓' : '·'}</span>
            <strong>{step.label}</strong><span className="setup-status">{step.phase}</span>
          </div>
          {step.phase === SetupPhase.Running && <Progress label={step.sublabel ?? step.label}
            {...(step.value != null && step.total != null && step.total > 0 ? { value: step.value, max: step.total } : {})} />}
          {step.total != null && step.total > 100 && step.value != null && <p>{formatBytes(step.value)} / {formatBytes(step.total)}</p>}
          {step.details.length > 0 && <details><summary>Details</summary><pre>{step.details.join('\n')}</pre></details>}
        </li>)}
      </ol>
    </section>
    {data.phase === SetupPhase.Failed && data.logAvailable && <Button variant="secondary" onClick={onLogs}>Open server logs</Button>}
  </main>
}
