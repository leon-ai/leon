import { useState } from 'react'
import { Button, ConnectionSetupWidget } from '../../../../aurora/src/v2'
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step, CONNECTION_SETUP_MESSAGES,
  getPreferredConnectionMethod,
  type ConnectionSetupAction } from '../../../../aurora/src/contracts/connection-setup'
import { CONNECTION_PREVIEW_STATES, connectionPreviewView,
  type ConnectionPreview as Preview } from '../../../fixtures/connection-preview'
import { CopyButton } from '@/components/copy-button'
import { PackageIcon } from '@/components/package-icon/package-icon'

declare const AURORA_CONNECTION_PREVIEWS: Preview[]

const CONNECTIONS = AURORA_CONNECTION_PREVIEWS

const PACKAGE_LOGOS = import.meta.glob<string>('../../../../tools/*/*/logo.svg', {
  eager: true, query: '?url&no-inline', import: 'default'
})

/**
 * Exercises trusted connection screens without contacting a provider or saving credentials.
 */
export function ConnectionPreview({ preview }: { preview: Preview }) {
  const logo = preview.logo
    ? PACKAGE_LOGOS[`../../../../tools/${preview.provider.replace('.', '/')}/${preview.logo}`] : undefined
  const [configuration, setConfiguration] = useState('application')
  const [step, setStep] = useState<string>(Step.Choice)
  const methods = Object.keys(preview.methods)
    .filter((id) => configuration !== 'fallback' || id !== 'oauth')
    .map((id) => ({ id }))
  const method = getPreferredConnectionMethod(methods)!.id
  const needsApplication = method === 'oauth' && !preview.serverURL && Object.keys(preview.methods[method]!.settings).length > 0
  const states = CONNECTION_PREVIEW_STATES.filter(({ value }) => {
    if ([Step.Application, Step.Assisted].includes(value as Step)) {
      return needsApplication && configuration !== 'ready'
    }
    if (value === 'authorizing' || value === 'cancelled') {
      return method === 'oauth'
    }

    return value !== 'saving' || method !== 'oauth'
  })

  async function act(action: ConnectionSetupAction): Promise<void> {
    switch (action.id) {
      case Action.Install:
      case Action.Enable:
      case Action.SelectMethod:
        setStep(Step.Choice)
        break
      case Action.Manual:
        setStep(method === 'oauth' && configuration !== 'ready' ? Step.Application : Step.Credentials)
        break
      case Action.Credentials:
        setStep(Step.Credentials)
        break
      case Action.StartSetup:
        setStep(Step.Assisted)
        break
      case Action.Connect:
        setStep(method === 'oauth' ? 'authorizing' : Step.Connected)
        break
      case Action.Continue:
        setStep(Step.Continued)
        break
    }
  }

  return <div className="demo-stack">
    <div className="demo-controls"><label>Preview configuration <select value={configuration} onChange={(event) => {
      setConfiguration(event.target.value)
      setStep(Step.Choice)
    }}>
      <option value="application">{needsApplication ? 'Application setup needed' : 'Default setup'}</option>
      {needsApplication && <option value="ready">Application already configured</option>}
      {preview.methods['api_key'] && <option value="fallback">OAuth unavailable</option>}
    </select></label><label>Preview state <select value={step} onChange={(event) => setStep(event.target.value)}>
      {states.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
    </select></label></div>
    <ConnectionSetupWidget title={preview.name} description={preview.description}
      view={step === 'loading' ? undefined : connectionPreviewView(preview, method, step, configuration === 'ready')}
      loading={step === 'loading'} busy={['authorizing', 'saving', 'adding', 'enabling'].includes(step)}
      error={step === 'failed' ? CONNECTION_SETUP_MESSAGES.actionError : undefined}
      icon={<PackageIcon assetSrc={logo} iconName={preview.iconName} />}
      onRefresh={() => setStep(step === 'loading' || step === 'failed' ? Step.Choice : step)}
      onAction={act} renderCopyButton={(item) => <CopyButton text={item.value} label={item.copyLabel} size="sm" />} />
    {['authorizing', 'saving', 'adding', 'enabling'].includes(step) && <div className="aurora-actions">
      <Button variant="secondary" onClick={() => setStep(step === 'adding' || step === 'enabling' ? Step.Choice : Step.Connected)}>
        {step === 'authorizing' ? 'Finish authorization' : 'Finish request'}
      </Button>
      {step === 'authorizing' && <Button onClick={() => setStep('cancelled')}>Cancel authorization</Button>}
    </div>}
    <p className="gallery-notice">Use sample values only. No account is connected and nothing is saved.</p>
  </div>
}

/**
 * Previews every declared native or MCP connection without installing tools or opening accounts.
 */
export function ConnectionsPreview() {
  const [provider, setProvider] = useState(CONNECTIONS[0]?.provider ?? '')
  const preview = CONNECTIONS.find((connection) => connection.provider === provider)

  return <section className="connections-preview demo-stack" aria-label="Connections preview">
    <div className="demo-controls"><label>Connection <select value={provider}
      onChange={(event) => setProvider(event.target.value)}>
      {CONNECTIONS.map((connection) => <option key={connection.provider} value={connection.provider}>{connection.name}</option>)}
    </select></label></div>
    {preview ? <ConnectionPreview key={preview.provider} preview={preview} /> : <p>No connections declared yet.</p>}
  </section>
}
