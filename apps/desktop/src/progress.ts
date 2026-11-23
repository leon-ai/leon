import { SetupPhase, type SetupState, type SetupStep } from '../../../bridges/runtime/contracts/desktop-setup'
import { EventEmitter } from 'node:events'
import { JsonRedactionHelper } from '../runtime/bootstrap-runtime.mjs'

const MAXIMUM_DETAILS = 100
const MAXIMUM_DETAIL_LENGTH = 2_048
const PUBLISH_INTERVAL_MS = 100
export { SetupPhase } from '../../../bridges/runtime/contracts/desktop-setup'

export interface ProgressStore {
  state: SetupState & { server?: string | null }
  events: EventEmitter
  step: (id: string, label: string, update?: Partial<SetupStep>) => SetupStep
  redact: (value: unknown) => string
  addSecrets: (values: Record<string, unknown>) => void
  update: (update: Partial<ProgressStore['state']>) => void
  detail: (id: string, line: string) => void
  close: () => void
}

/**
 * Retains bounded setup evidence and coalesces events before sending them to UI.
 */
export function createProgressStore(environment = process.env): ProgressStore {
  const events = new EventEmitter()
  const secrets = Object.entries(environment).filter(([key, value]) =>
    JsonRedactionHelper.isSensitiveKey(key) && typeof value === 'string' && value.length >= 8).map(([, value]) => value!)
  const state: SetupState & { server?: string | null } = { phase: SetupPhase.Idle, steps: [], service: false }
  let timer: NodeJS.Timeout | undefined
  const redact = (value: unknown): string => {
    let text = String(value)
    for (const secret of secrets) {
      text = text.replaceAll(secret, '***')
    }
    return text.slice(0, MAXIMUM_DETAIL_LENGTH)
  }
  const publish = (): void => {
    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined
        events.emit('change', state)
      }, PUBLISH_INTERVAL_MS)
      timer.unref()
    }
  }
  const step = (id: string, label: string, update: Partial<SetupStep> = {}): SetupStep => {
    let current = state.steps.find((item) => item.id === id)
    if (!current) {
      current = { id, label, phase: SetupPhase.Running, details: [redact(label)] }
      state.steps.push(current)
    }
    Object.assign(current, update, { label: redact(label) })
    publish()
    return current
  }
  return { state, events, step, redact,
    addSecrets(values: Record<string, unknown>): void {
      for (const [key, value] of Object.entries(values)) {
        if (JsonRedactionHelper.isSensitiveKey(key) && typeof value === 'string' && value.length >= 8 && !secrets.includes(value)) {
          secrets.push(value)
        }
      }
    },
    update(update: Partial<typeof state>): void {
      Object.assign(state, update)
      publish()
    },
    detail(id: string, line: string): void {
      const current = state.steps.find((item) => item.id === id)
      if (current && line) {
        current.details.push(redact(line))
        current.details.splice(0, Math.max(0, current.details.length - MAXIMUM_DETAILS))
        publish()
      }
    },
    close(): void {
      clearTimeout(timer)
      events.removeAllListeners()
    }
  }
}
