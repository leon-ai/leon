import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/button/button'
import { Badge, type BadgeProps } from '../components/badge/badge'
import { Input } from '../components/input/input'
import { Surface } from '../components/surface'
import { Collapse } from '../components/collapse/collapse'
import {
  ConnectionSetupActionId as Action, ConnectionSetupStep as Step,
  CONNECTION_SETUP_MESSAGES, type ConnectionSetupAction, type ConnectionSetupView
} from '../../contracts/connection-setup'
import { isPresentationURL } from '../contracts/presentation'

import './connection-setup.sass'

const ACTION_LOADING_LABELS: Partial<Record<Action, string>> = {
  [Action.Connect]: 'Connecting…',
  [Action.Install]: 'Adding…',
  [Action.Enable]: 'Enabling…',
  [Action.StartSetup]: 'Starting setup…',
  [Action.Continue]: 'Continuing…'
}

export interface ConnectionSetupWidgetProps {
  title: string
  description?: string
  view: ConnectionSetupView | undefined
  busy: boolean
  loading: boolean
  error?: string | undefined
  icon?: ReactNode
  onRefresh: () => void
  onAction: (action: ConnectionSetupAction, state: ConnectionSetupView['state'], credentials: Record<string, string>) => Promise<void>
  renderCopyButton: (item: NonNullable<ConnectionSetupView['details']>['values'][number]) => ReactNode
  renderLink?: (link: ConnectionSetupView['links'][number]) => ReactNode
}

/**
 * Renders trusted server-owned connection screens, never model-authored forms.
 * Credentials live only in native fields and the active request, not drafts or
 * React state; every attempt clears the fields, including transport failures.
 */
export function ConnectionSetupWidget({ title, description, view, busy, loading, error, icon,
  onRefresh, onAction, renderCopyButton, renderLink }: ConnectionSetupWidgetProps) {
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const pending = useRef(false)
  const [activeAction, setActiveAction] = useState<string>()
  const [formValid, setFormValid] = useState(false)
  const messages = view?.messages ?? CONNECTION_SETUP_MESSAGES
  const name = view?.tool?.name ?? view?.title ?? title
  const toolDescription = view?.tool?.description ?? description
  const connected = view?.state.step === Step.Connected || view?.state.step === Step.Continued
  const primary = view?.actions.find((action) => !action.secondary)
  const secondary = view?.actions.filter((action) => action !== primary) ?? []
  const assistance = secondary.find((action) => action.id === Action.StartSetup)
  const footerActions = secondary.filter((action) => action !== assistance)
  const working = busy || activeAction !== undefined
  const loadingAction = activeAction ?? (busy ? primary?.id : undefined)
  const links = view?.links.filter((link) => isPresentationURL(link.href)) ?? []
  const instructions = view?.details?.instructions ?? []
  const expanded = Boolean(view && (view.fields.length ||
    [Step.Application, Step.Credentials, Step.Assisted].includes(view.state.step as Step)))
  const notice = view?.notice && (view.state.step !== Step.Installation || !primary) ? view.notice : undefined
  const hasBody = expanded || view?.details || links.length > 0 || error || notice
  const hasFooter = primary || footerActions.length > 0 || !view
  const badge: BadgeProps | undefined = connected ? { label: 'Connected', variant: 'success' }
    : error ? { label: 'Request failed', variant: 'error' }
      : view?.state.step === Step.Disabled ? { label: 'Disabled', variant: 'secondary' }
        : notice ? { label: 'Not connected', variant: 'warning' } : undefined
  const primaryLabel = primary?.id === Action.Install ? 'Add'
    : primary?.id === Action.Enable ? 'Enable'
      : primary?.id === Action.Connect || primary?.id === Action.Credentials ? 'Connect' : primary?.label

  function updateFormValidity(): void {
    const form = formRef.current
    // Only the validity flag enters React state. Required whitespace-only
    // credentials must remain invalid even though native required accepts them.
    setFormValid(Boolean(form?.matches(':valid') && [...form.querySelectorAll('input')].every((input) => {
      return !input.required || input.value.trim().length > 0
    })))
  }

  useLayoutEffect(() => {
    updateFormValidity()
  }, [view?.fields, expanded, working])

  async function act(action: ConnectionSetupAction): Promise<void> {
    if (!view || busy || pending.current) {
      return
    }

    pending.current = true
    setActiveAction(action.id)
    const form = formRef.current
    const credentials: Record<string, string> = {}
    if (action.submit && form) {
      const fields = new FormData(form)
      for (const field of view.fields) {
        credentials[field.name] = String(fields.get(field.name) ?? '')
        fields.delete(field.name)
      }
    }

    try {
      const result = onAction(action, view.state, credentials)
      // Authorization may remain open for minutes; clear native secrets as soon
      // as the host owns the submission, not when the provider flow finishes.
      form?.reset()
      updateFormValidity()
      await result
    } catch {
      // The host reports only sanitized errors, never credential-bearing errors.
    } finally {
      form?.reset()
      updateFormValidity()
      for (const name of Object.keys(credentials)) {
        credentials[name] = ''
      }
      pending.current = false
      setActiveAction(undefined)
    }
  }

  function actionButton(action: ConnectionSetupAction, secondary = false): ReactNode {
    const loading = loadingAction === action.id
    const label = loading ? ACTION_LOADING_LABELS[action.id as Action] ?? 'Loading…'
      : secondary ? action.label : primaryLabel ?? action.label

    return <Button key={`${action.id}:${action.method ?? ''}`} variant={secondary ? 'secondary' : 'primary'}
      type={action.submit ? 'submit' : 'button'}
      {...(action.submit ? { form: formId } : {})}
      disabled={working || Boolean(action.submit && !formValid)} loading={loading}
      ariaLabel={loading ? label : action.label}
      {...(action.id === Action.Credentials ? { ariaExpanded: expanded } : {})}
      onClick={() => {
        if (!action.submit) {
          void act(action)
        }
      }}>{label}</Button>
  }

  function setupLink(link: ConnectionSetupView['links'][number]): ReactNode {
    return renderLink ? renderLink(link) : <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
  }

  return <div className="aurora-connection">
    <Surface title={name} header={<header className="aurora-connection-header" data-with-icon={Boolean(icon)}>
      {icon && <span className="aurora-connection-icon" aria-hidden="true">{icon}</span>}
      <div className="aurora-connection-identity">
        <h3>{name}</h3>
        {toolDescription && <p>{toolDescription}</p>}
      </div>
      {badge && <div className="aurora-connection-status" role={connected ? 'status' : undefined}>
        <Badge {...badge} />
        {connected && view?.status && view.status !== 'Connected' && <p className="aurora-feedback">{view.status}</p>}
      </div>}
    </header>} footer={hasFooter && <>
      {footerActions.map((action) => actionButton(action, true))}
      {primary && actionButton(primary)}
      {!view && (error ? <Button variant="primary" loading={loading} onClick={onRefresh}>{loading ? 'Loading…' : messages.retry}</Button>
        : <Button variant="primary" loading disabled>Loading…</Button>)}
    </>}>
      <Collapse isOpen={Boolean(hasBody)} className="aurora-connection-collapse">
        <div className="aurora-connection-body">
          {error && <p className="aurora-feedback" role="alert">{error}</p>}
          {view && <>
            {notice && <p className="aurora-feedback" role="status">{notice}</p>}
            {expanded && <div className="aurora-connection-form">
              {view.description && <p className="aurora-feedback">{view.description}</p>}
              <form key={view.state.method} id={formId} ref={formRef} autoComplete="off" className="aurora-fields"
                onInput={updateFormValidity}
                onSubmit={(event) => {
                  event.preventDefault()
                  const action = view.actions.find((entry) => entry.submit)
                  if (action && formValid && !working) {
                    void act(action)
                  }
                }}>
                <fieldset className="aurora-fields" disabled={working} aria-label={`${name} fields`}>
                  {view.fields.map((field) => <label className="aurora-field" key={field.name}>
                    <span>{field.label}</span>
                    <Input ariaLabel={field.label} name={field.name} type={field.type} required={field.required}
                      maxLength={field.maxLength} autoComplete="off" spellCheck={false}
                      defaultValue={field.type === 'password' ? '' : field.value} />
                  </label>)}
                </fieldset>
              </form>
            </div>}
            {(view.details || assistance || links.length > 0) && <div className="aurora-connection-setup">
              <div className="aurora-connection-details">
                {instructions.length > 0 && <ol>{instructions.map((instruction, index) => <li key={index}>
                  {index === 0 && links[0] ? setupLink({ ...links[0], label: instruction }) : instruction}
                </li>)}</ol>}
                {links.slice(instructions.length > 0 ? 1 : 0).map((link) => <p key={link.href}>{setupLink(link)}</p>)}
              </div>
              {view.details && view.details.values.length > 0 && <dl className="aurora-connection-values">{view.details.values.map((item) => <div key={item.label}>
                <dt>{item.label}</dt><dd><code>{item.value}</code>{renderCopyButton(item)}</dd>
              </div>)}</dl>}
            </div>}
            {assistance && <div className="aurora-connection-assistance">
              <div className="aurora-connection-divider" role="separator" aria-label="or"><span>or</span></div>
              {actionButton(assistance, true)}
            </div>}
          </>}
        </div>
      </Collapse>
    </Surface>
  </div>
}
