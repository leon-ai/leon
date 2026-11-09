import { useRef, type ReactNode } from 'react'
import { Button } from '../components/button/button'
import { Input } from '../components/input/input'
import { Loader } from '../components/loader/loader'
import { Surface } from '../components/surface'
import { CONNECTION_SETUP_MESSAGES, type ConnectionSetupAction, type ConnectionSetupView } from '../../contracts/connection-setup'
import { isPresentationURL } from '../contracts/presentation'

import './connection-setup.sass'

export interface ConnectionSetupWidgetProps {
  title: string
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
export function ConnectionSetupWidget({ title, view, busy, loading, error, icon, statusIcon,
  onRefresh, onAction, renderCopyButton, renderLink }: ConnectionSetupWidgetProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const pending = useRef(false)
  const messages = view?.messages ?? CONNECTION_SETUP_MESSAGES

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
    <Surface title={view?.title ?? title} {...(view?.description ? { description: view.description } : {})}>
      {icon && <span className="aurora-connection-icon" aria-hidden="true">{icon}</span>}
      {loading && !view && <Loader size="sm" label="Getting connection setup ready…" />}
      {error && <p className="aurora-feedback" role="alert">{error}</p>}
      {!view && error && <Button variant="secondary" onClick={onRefresh}>{messages.retry}</Button>}
      {view && <>
        {view.status && <p className="aurora-connection-status" role="status">{statusIcon}{view.status}</p>}
        {view.notice && <p className="aurora-feedback" role="status">{view.notice}</p>}
        {view.links.filter((link) => isPresentationURL(link.href)).map((link) => <div key={link.href}>
          {renderLink ? renderLink(link) : <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>}
        </div>)}
        {view.details && <details className="aurora-connection-details">
          <summary>{view.details.label}</summary>
          <ol>{view.details.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>
          <dl>{view.details.values.map((item) => <div key={item.label}>
            <dt>{item.label}</dt><dd><code>{item.value}</code>{renderCopyButton(item)}</dd>
          </div>)}</dl>
        </details>}
        <form key={`${view.state.method}:${view.state.step}`} ref={formRef} autoComplete="off" className="aurora-fields"
          onSubmit={(event) => {
            event.preventDefault()
            const action = view.actions.find((entry) => entry.submit)
            if (action) {
              void act(action)
            }
          }}>
          <fieldset className="aurora-fields" disabled={busy} aria-label={`${view.title} fields`}>
            {view.fields.map((field) => <label className="aurora-field" key={field.name}>
              <span>{field.label}</span>
              <Input ariaLabel={field.label} name={field.name} type={field.type} required={field.required}
                maxLength={field.maxLength} autoComplete="off" spellCheck={false}
                defaultValue={field.type === 'password' ? '' : field.value} />
            </label>)}
          </fieldset>
          <div className="aurora-actions" aria-busy={busy}>
            {view.actions.map((action) => <Button key={`${action.id}:${action.method ?? ''}`}
              type={action.submit ? 'submit' : 'button'} variant={action.secondary ? 'secondary' : 'primary'} disabled={busy}
              {...(action.submit ? {} : { onClick: () => {
                void act(action)
              } })}>
              {action.label}
            </Button>)}
            {busy && <Loader size="sm" label="Working on the connection…" />}
          </div>
        </form>
        <div className="aurora-actions"><Button size="sm" disabled={busy} loading={loading} onClick={onRefresh}>Refresh status</Button></div>
      </>}
    </Surface>
  </div>
}
