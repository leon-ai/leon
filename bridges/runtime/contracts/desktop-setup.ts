/**
 * Shared lifecycle states for managed server setup and its native client view.
 */
export enum SetupPhase {
  Idle = 'idle', Running = 'running', Complete = 'complete', Failed = 'failed', Cancelled = 'cancelled'
}
export interface SetupStep {
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
  steps: SetupStep[]
  installation?: string | null
  service: boolean
  logAvailable?: boolean
  external?: boolean
  error?: string | null
}
