import { useState } from 'react'
import { Button, ConnectionSetupWidget } from '../../../../aurora/src/v2'
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step, CONNECTION_SETUP_MESSAGES,
  getPreferredConnectionMethod,
  type ConnectionSetupAction } from '../../../../aurora/src/contracts/connection-setup'
import { CONNECTION_PREVIEWS, CONNECTION_PREVIEW_STATES, connectionPreviewView } from '../../../fixtures/connections'
import { CopyButton } from '@/components/copy-button'
import { Icon } from '@/components/icon'

/**
 * Exercises trusted connection screens without contacting a provider or saving credentials.
 */
export function ConnectionPreview({ id }: { id: string }) {
  const preview = CONNECTION_PREVIEWS[id]!
  const [configuration, setConfiguration] = useState('application')
  const [step, setStep] = useState<string>(Step.Choice)
  const methods = Object.keys(preview.methods)
    .filter((id) => configuration !== 'fallback' || id !== 'oauth')
    .map((id) => ({ id }))
  const method = getPreferredConnectionMethod(methods)!.id

  async function act(action: ConnectionSetupAction): Promise<void> {
    switch (action.id) {
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
      <option value="application">Application setup needed</option>
      <option value="ready">Application already configured</option>
      {preview.methods['api_key'] && <option value="fallback">OAuth unavailable</option>}
    </select></label><label>Preview state <select value={step} onChange={(event) => setStep(event.target.value)}>
      {CONNECTION_PREVIEW_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
    </select></label></div>
    <ConnectionSetupWidget title={`Set up ${preview.name}`} view={step === 'loading' ? undefined : connectionPreviewView(preview, method, step, configuration === 'ready')}
      loading={step === 'loading'} busy={step === 'authorizing'}
      error={step === 'failed' ? CONNECTION_SETUP_MESSAGES.actionError : undefined}
      icon={<Icon name={preview.iconName} />} statusIcon={<Icon name="check-fill" />}
      onRefresh={() => setStep(step === 'loading' || step === 'failed' ? Step.Choice : step)}
      onAction={act} renderCopyButton={(item) => <CopyButton text={item.value} label={item.copyLabel} size="sm" />} />
    {step === 'authorizing' && <div className="aurora-actions">
      <Button variant="secondary" onClick={() => setStep(Step.Connected)}>Finish authorization</Button>
      <Button onClick={() => setStep('cancelled')}>Cancel authorization</Button>
    </div>}
    <p className="gallery-notice">Use sample values only. No account is connected and nothing is saved.</p>
  </div>
}
