import { useRef, type ReactNode } from 'react'
import { Button } from '../components/button/button'
import { Input } from '../components/input/input'
import { Loader } from '../components/loader/loader'
import { Surface } from '../components/surface'
import {
  ConnectionSetupActionId as Action, ConnectionSetupStep as Step,
  CONNECTION_SETUP_MESSAGES, type ConnectionSetupAction, type ConnectionSetupView
} from '../../contracts/connection-setup'
import { isPresentationURL } from '../contracts/presentation'

import './connection-setup.sass'

export interface ConnectionSetupWidgetProps {
  title: string
  description?: string
  view: ConnectionSetupView | undefined
  busy: boolean
  loading: boolean
  error?: string | undefined
  icon?: ReactNode
  statusIcon?: ReactNode
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
export function ConnectionSetupWidget({ title, description, view, busy, loading, error, icon, statusIcon,
  onRefresh, onAction, renderCopyButton, renderLink }: ConnectionSetupWidgetProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const pending = useRef(false)
  const messages = view?.messages ?? CONNECTION_SETUP_MESSAGES
  const name = view?.tool?.name ?? view?.title ?? title
  const toolDescription = view?.tool?.description ?? description
  const primary = view?.actions.find((action) => !action.secondary)
  const secondary = view?.actions.filter((action) => action !== primary) ?? []
  const expanded = Boolean(view && (view.fields.length ||
    [Step.Application, Step.Credentials, Step.Assisted].includes(view.state.step as Step)))
  const primaryLabel = primary?.id === Action.Install ? 'Add'
    : primary?.id === Action.Enable ? 'Enable'
      : primary?.id === Action.Connect || primary?.id === Action.Credentials ? 'Connect' : primary?.label

  async function act(action: ConnectionSetupAction): Promise<void> {
    if (!view || busy || pending.current) {
      return
    }

    pending.current = true
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
      await result
    } catch {
      // The host reports only sanitized errors, never credential-bearing errors.
    } finally {
      form?.reset()
      for (const name of Object.keys(credentials)) {
        credentials[name] = ''
      }
      pending.current = false
    }
  }

  return <div className="aurora-connection">
    <Surface title={name} header={<header className="aurora-connection-header" data-with-icon={Boolean(icon)}>
      {icon && <span className="aurora-connection-icon" aria-hidden="true">{icon}</span>}
      <div className="aurora-connection-identity">
        <h3>{name}</h3>
        {toolDescription && <p>{toolDescription}</p>}
      </div>
      <div className="aurora-connection-action" aria-busy={busy}>
        {primary && <Button variant="primary" disabled={busy || loading}
          ariaLabel={primary.label}
          {...(primary.id === Action.Credentials ? { ariaExpanded: expanded } : {})}
          onClick={() => {
            if (primary.submit) {
              // Keep the header action tied to native field validation and Enter
              // submission without duplicating credentials or form state.
              formRef.current?.requestSubmit()
            } else {
              void act(primary)
            }
          }}>
          {primaryLabel}
        </Button>}
        {busy && <Loader size="sm" label="Working on the connection…" />}
        {loading && !view && <Loader size="sm" label="Getting connection setup ready…" />}
        {view?.status && <p className="aurora-connection-status" role="status">{statusIcon}{view.status}</p>}
      </div>
    </header>}>
      {error && <p className="aurora-feedback" role="alert">{error}</p>}
      {!view && error && <Button variant="secondary" onClick={onRefresh}>{messages.retry}</Button>}
      {view && <>
        {view.notice && (view.state.step !== Step.Installation || !primary) &&
          <p className="aurora-feedback" role="status">{view.notice}</p>}
        {expanded && <div className="aurora-connection-expanded">
          <div className="aurora-connection-expanded-content">
            {view.description && <p className="aurora-feedback">{view.description}</p>}
            <form key={`${view.state.method}:${view.state.step}`} ref={formRef} autoComplete="off" className="aurora-fields"
              onSubmit={(event) => {
                event.preventDefault()
                const action = view.actions.find((entry) => entry.submit)
                if (action) {
                  void act(action)
                }
              }}>
              <fieldset className="aurora-fields" disabled={busy} aria-label={`${name} fields`}>
                {view.fields.map((field) => <label className="aurora-field" key={field.name}>
                  <span>{field.label}</span>
                  <Input ariaLabel={field.label} name={field.name} type={field.type} required={field.required}
                    maxLength={field.maxLength} autoComplete="off" spellCheck={false}
                    defaultValue={field.type === 'password' ? '' : field.value} />
                </label>)}
              </fieldset>
              {primary?.submit && <button type="submit" hidden tabIndex={-1} />}
            </form>
          </div>
        </div>}
        {(view.details || secondary.length > 0 || view.links.length > 0) && <details className="aurora-connection-details">
          <summary>{expanded ? view.details?.label ?? 'Connection options' : 'Connection options'}</summary>
          <div className="aurora-connection-options">
            {view.links.filter((link) => isPresentationURL(link.href)).map((link) => <div key={link.href}>
              {renderLink ? renderLink(link) : <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>}
            </div>)}
            {view.details && <>
              {view.details.instructions.length > 0 && <ol>{view.details.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>}
              {view.details.values.length > 0 && <dl>{view.details.values.map((item) => <div key={item.label}>
                <dt>{item.label}</dt><dd><code>{item.value}</code>{renderCopyButton(item)}</dd>
              </div>)}</dl>}
            </>}
            {secondary.length > 0 && <div className="aurora-actions">
              {secondary.map((action) => <Button key={`${action.id}:${action.method ?? ''}`}
                variant="secondary" disabled={busy || loading} onClick={() => {
                  void act(action)
                }}>{action.label}</Button>)}
            </div>}
          </div>
        </details>}
      </>}
    </Surface>
  </div>
}
