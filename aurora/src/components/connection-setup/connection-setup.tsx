import { useEffect, useRef, useState } from 'react'

import { Button, Input, Link, Loader, Status, Text } from '../..'

import './connection-setup.sass'

export interface ConnectionSetupAction {
  id: string
  label: string
  method?: string
  secondary?: boolean
  submit?: boolean
}

export interface ConnectionSetupView {
  state: { method: string, step: string }
  title: string
  description: string
  status?: string
  notice?: string
  fields: Array<{
    name: string
    label: string
    type: 'text' | 'password'
    required: boolean
    value: string
    maxLength: number
  }>
  links: Array<{ label: string, href: string }>
  details?: {
    label: string
    instructions: string[]
    values: Array<{ label: string, value: string, copyLabel: string }>
  }
  actions: ConnectionSetupAction[]
  messages: {
    loadError: string
    actionError: string
    retry: string
    copied: string
    copyFailed: string
  }
}

export interface ConnectionSetupProps {
  provider: string
  messages?: ConnectionSetupView['messages']
  onLoad: (state?: ConnectionSetupView['state']) => Promise<ConnectionSetupView>
  onAction: (
    action: ConnectionSetupAction,
    state: ConnectionSetupView['state'],
    values: Record<string, string>
  ) => Promise<ConnectionSetupView>
}

/**
 * Copies a public value using labels supplied with the server screen.
 */
function SetupValue({
  item,
  messages
}: {
  item: NonNullable<ConnectionSetupView['details']>['values'][number]
  messages: ConnectionSetupView['messages']
}) {
  const [notice, setNotice] = useState('')

  return (
    <div className="aurora-connection-setup__value">
      <Text>{item.label}</Text>
      <code>{item.value}</code>
      <Button
        secondary
        onClick={() => {
          if (!navigator.clipboard) {
            setNotice(messages.copyFailed)

            return
          }

          void navigator.clipboard
            .writeText(item.value)
            .then(() => setNotice(messages.copied))
            .catch(() => setNotice(messages.copyFailed))
        }}
      >
        {item.copyLabel}
      </Button>
      <span role="status">{notice}</span>
    </div>
  )
}

/**
 * Renders the server's screen and actions without deciding connection workflow steps.
 * Secret inputs remain local until submission and are never part of the saved widget.
 */
export function ConnectionSetup({
  provider,
  messages,
  onLoad,
  onAction
}: ConnectionSetupProps) {
  const [view, setView] = useState<ConnectionSetupView | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useRef<ConnectionSetupView | null>(null)
  const pending = useRef(false)
  const version = useRef(0)
  const labels = view?.messages || messages

  useEffect(() => {
    let active = true
    const refresh = () => {
      if (pending.current) {
        return
      }

      const requestVersion = ++version.current

      void onLoad(current.current?.state)
        .then((next) => {
          // A focus refresh must not replace a more recent action response.
          if (active && requestVersion === version.current) {
            if (
              JSON.stringify(next.state) !==
              JSON.stringify(current.current?.state)
            ) {
              setValues({})
            }

            current.current = next
            setView(next)
            setError('')
          }
        })
        .catch(() => {
          if (active && requestVersion === version.current) {
            setError('load')
          }
        })
    }

    refresh()
    window.addEventListener('focus', refresh)

    return () => {
      active = false
      window.removeEventListener('focus', refresh)
    }
  }, [provider, onLoad])

  const act = async (action: ConnectionSetupAction) => {
    if (!view || pending.current) {
      return
    }

    pending.current = true
    ++version.current
    setBusy(true)
    setError('')
    try {
      const next = await onAction(
        action,
        view.state,
        action.submit ? values : {}
      )

      current.current = next
      setView(next)
      setValues({})
    } catch {
      // Transport errors may retain credential-bearing request bodies.
      setError('action')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="aurora-connection-setup">
      {error && (
        <div role="alert">
          <Status color="red">
            {error === 'load' ? labels?.loadError : labels?.actionError}
          </Status>
        </div>
      )}
      {!view && !error && <Loader />}
      {error === 'load' && (
        <Button
          iconName="refresh"
          onClick={() => {
            void onLoad(current.current?.state)
              .then((next) => {
                current.current = next
                setView(next)
                setError('')
              })
              .catch(() => setError('load'))
          }}
        >
          {labels?.retry}
        </Button>
      )}
      {view && (
        <>
          <Text>{view.title}</Text>
          {view.status && <Status color="green">{view.status}</Status>}
          <Text secondary>{view.description}</Text>
          {view.notice && (
            <div role="status">
              <Text secondary>{view.notice}</Text>
            </div>
          )}
          {view.links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          {view.details && (
            <details className="aurora-connection-setup__details">
              <summary>{view.details.label}</summary>
              <ol>
                {view.details.instructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
              {view.details.values.map((item) => (
                <SetupValue
                  key={item.label}
                  item={item}
                  messages={view.messages}
                />
              ))}
            </details>
          )}
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault()
              const action = view.actions.find((entry) => entry.submit)

              if (action) {
                void act(action)
              }
            }}
          >
            <div className="aurora-connection-setup__method">
              {view.fields.map((field) => (
                <label key={field.name}>
                  <Text>{field.label}</Text>
                  <Input
                    name={field.name}
                    placeholder={field.label}
                    type={field.type}
                    required={field.required}
                    maxLength={field.maxLength}
                    disabled={busy}
                    value={values[field.name] ?? field.value}
                    onChange={(value) =>
                      setValues((previous) => ({
                        ...previous,
                        [field.name]: value
                      }))
                    }
                  />
                </label>
              ))}
              {view.actions.map((action) => (
                <Button
                  key={`${action.id}:${action.method || ''}`}
                  type={action.submit ? 'submit' : 'button'}
                  secondary={action.secondary}
                  disabled={busy}
                  onClick={() => {
                    void act(action)
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </form>
        </>
      )}
    </div>
  )
}
