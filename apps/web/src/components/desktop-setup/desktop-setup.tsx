import type { ReactNode } from 'react'
import { Button } from '@/components/button'
import { Progress } from '../../../../../aurora/src/v2/components/progress'
import { formatBytes } from '../../../../../aurora/src/v2/utils/format-bytes'
import './desktop-setup.sass'

export enum SetupPhase {
  Idle = 'idle', Running = 'running', Complete = 'complete', Failed = 'failed', Cancelled = 'cancelled'
}
interface Step {
  id: string
  label: string
  phase: SetupPhase
  sublabel?: string | null
  value?: number | null
  total?: number | null
  details: string[]
}
export interface SetupState {
  phase: SetupPhase
  steps: Step[]
  installation?: string | null
  service: boolean
  logAvailable?: boolean
  external?: boolean
  error?: string | null
}


interface DesktopSetupViewProps {
  data: SetupState
  existingPath?: string | null
  pending: boolean
  choosing: boolean
  error?: string | null
  desktop?: ReactNode
  onStart: () => void
  onChoose: () => void
  onCancel: () => void
  onConnect: () => void
  onStartup: (enabled: boolean) => void
  onLogs: () => void
  onStop: () => void
}

/**
 * Presents the real managed Core setup and lifetime controls independently of
 * transport, so desktop setup and Aurora previews share every visible state.
 */
export function DesktopSetupView({ data, existingPath, pending, choosing, error, desktop,
  onStart, onChoose, onCancel, onConnect, onStartup, onLogs, onStop }: DesktopSetupViewProps) {
  const running = data.phase === SetupPhase.Running
  const ready = data.phase === SetupPhase.Complete
  return <main className="setup">
    <header><h1>{ready ? 'I’m ready' : 'Let’s get Leon ready'}</h1>
      <p>I’ll keep my server separate from this window, so you can reach me from the desktop or your browser.</p></header>
    <section aria-label="Installation">
      <div className="setup-actions">
        {!running && !ready && <>
          <Button variant="primary" disabled={pending} onClick={onStart}>
            {data.phase === SetupPhase.Idle ? 'Get started' : 'Retry setup'}
          </Button>
          <Button variant="secondary" loading={choosing} onClick={onChoose}>Choose existing installation</Button>
        </>}
        {running && <Button variant="secondary" disabled={pending} onClick={onCancel}>Cancel setup</Button>}
        {ready && <Button variant="primary" disabled={pending} onClick={onConnect}>Open Leon</Button>}
      </div>
      {(existingPath ?? data.installation) && <p className="setup-path">{existingPath ?? data.installation}</p>}
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
    {ready && !data.external && <section aria-label="Core lifecycle">
      <h2>Keep me available</h2><p>My Core keeps running when you close the desktop app. Startup runs at sign-in, without opening this window.</p>
      <label className="setup-startup"><input type="checkbox" checked={data.service} disabled={pending}
        onChange={(event) => onStartup(event.target.checked)} />Start Core when I sign in</label>
      <div className="setup-actions"><Button variant="secondary" onClick={onLogs}>Open Core logs</Button>
        <Button variant="ghost" disabled={pending} onClick={onStop}>Stop Core</Button></div>
    </section>}
    {data.phase === SetupPhase.Failed && data.logAvailable && <Button variant="secondary" onClick={onLogs}>Open Core logs</Button>}
    {desktop}
    {ready && data.external && <p>I connected to a running Core. Its existing process manages startup and shutdown.</p>}
  </main>
}
