import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step, CONNECTION_SETUP_MESSAGES,
  type ConnectionSetupView } from '../../aurora/src/contracts/connection-setup.ts'
import { StringHelper } from '../../server/src/helpers/string-helper.ts'

interface PreviewMethod {
  name: string
  description: string
  setup_url: string
  settings: Record<string, string | null>
  setup?: { instructions: string[], values: Record<string, string> }
}

export interface ConnectionPreview {
  provider: string
  name: string
  description: string
  iconName: string
  logo?: string
  methods: Record<string, PreviewMethod>
  serverURL?: string
}

export type ConnectionPreviewManifest = Pick<ConnectionPreview, 'name' | 'description' | 'logo'> & {
  toolkit_id: string
  tool_id: string
  icon_name?: string
  connection?: { methods: Record<string, PreviewMethod> }
  source?: { type: string, url: string }
}

/**
 * Derives preview identity and methods from public manifests, never profile secrets.
 */
export function createConnectionPreview(manifest: ConnectionPreviewManifest): ConnectionPreview | undefined {
  const remote = manifest.source?.type === 'mcp'
  const methods = remote ? {
    oauth: { name: 'OAuth', description: 'Sign in on the provider’s website to choose what I can access.',
      setup_url: manifest.source!.url, settings: {} }
  } : manifest.connection?.methods

  if (!methods || Object.keys(methods).length === 0) {
    return undefined
  }

  return { provider: `${manifest.toolkit_id}.${manifest.tool_id}`, name: manifest.name,
    description: manifest.description, iconName: manifest.icon_name ?? 'plug-line',
    ...(manifest.logo ? { logo: manifest.logo } : {}), methods,
    ...(remote ? { serverURL: manifest.source!.url } : {}) }
}

export const CONNECTION_PREVIEW_STATES = [
  { value: Step.Installation, label: 'Not added' },
  { value: Step.Disabled, label: 'Disabled' },
  { value: Step.Choice, label: 'Start' },
  { value: Step.Application, label: 'Setup instructions' },
  { value: Step.Credentials, label: 'Connection fields' },
  { value: Step.Assisted, label: 'Guided setup' },
  { value: 'authorizing', label: 'Authorizing' },
  { value: 'saving', label: 'Saving credentials' },
  { value: 'adding', label: 'Adding' },
  { value: 'enabling', label: 'Enabling' },
  { value: Step.Connected, label: 'Connected' },
  { value: Step.Continued, label: 'Continued' },
  { value: 'failed', label: 'Failed request' },
  { value: 'cancelled', label: 'Authorization cancelled' },
  { value: 'loading', label: 'Loading' }
] as const

/**
 * Supplies local gallery screens from the actual public tool declarations.
 * It simulates presentation only: no account validation, authorization or writes.
 */
export function connectionPreviewView(preview: ConnectionPreview, methodId: string, step: string,
  oauthConfigured = false): ConnectionSetupView {
  const method = preview.methods[methodId]!
  const needsApplication = methodId === 'oauth' && !oauthConfigured && Object.keys(method.settings).length > 0
  const connected = step === Step.Connected || step === Step.Continued
  const credentials = [Step.Credentials, Step.Application, Step.Assisted, 'failed', 'saving'].includes(step) || step === 'authorizing' && needsApplication
  const view: ConnectionSetupView = {
    state: { method: methodId, step }, title: connected ? preview.name : `Set up ${preview.name}`,
    tool: { name: preview.name, description: preview.description },
    description: connected ? 'This is a local preview. No account was connected.' :
      step === Step.Assisted ? 'You can follow setup progress in the conversation.' :
        needsApplication ? 'A one-time application setup is needed before you can authorize access. Enter its credentials to get started.' :
          methodId === 'oauth' ? 'Authorize access on the provider’s website. You stay in control of your permissions.' : method.description,
    fields: [], links: [], actions: [], messages: CONNECTION_SETUP_MESSAGES,
    ...(connected ? { status: 'Connected' } : {}),
    ...(step === 'cancelled' ? { notice: 'Authorization was cancelled. You can start again when you’re ready.' } : {})
  }

  if ([Step.Installation, Step.Disabled, 'adding', 'enabling'].includes(step)) {
    const adding = step === Step.Installation || step === 'adding'
    view.description = adding
      ? `${preview.name} is in my catalog, but hasn’t been added to this profile.`
      : `${preview.name} is added but currently disabled.`
    view.actions.push({
      id: adding ? Action.Install : Action.Enable,
      label: `${adding ? 'Add' : 'Enable'} ${preview.name}`
    })

    return view
  }

  if (connected) {
    if (step !== Step.Continued) {
      view.actions.push({ id: Action.Continue, label: 'Continue' })
    }
    return view
  }

  if (preview.serverURL) {
    view.description = 'Sign in on the provider’s website to choose what I can access.'
    if (credentials) {
      view.fields = [
        { name: 'client_id', label: 'Client ID', type: 'text', required: false, value: '', maxLength: 256 },
        { name: 'client_metadata_url', label: 'Client metadata URL', type: 'text', required: false, value: '', maxLength: 2_048 }
      ]
      view.details = { label: 'Connection details', instructions: [
        'Use a public OAuth application with the redirect URI below. Client secrets are not supported by this flow.',
        'Enter its client ID or HTTPS client metadata URL only if the server requires it. Leave both empty for automatic registration.',
        'Changing application settings clears the previous authorization before starting a new sign-in.'
      ], values: [
        { label: 'MCP server', value: preview.serverURL, copyLabel: 'Copy server URL' },
        { label: 'Redirect URI', value: 'http://127.0.0.1:1337/api/v1/tools/oauth/callback', copyLabel: 'Copy redirect URI' }
      ] }
    }
    view.actions.push({ id: Action.Connect, label: `Connect ${preview.name}`, ...(credentials ? { submit: true } : {}) })
    view.actions.push({ id: credentials ? Action.SelectMethod : Action.Credentials,
      label: credentials ? 'Back' : 'Display OAuth settings', secondary: true })

    return view
  }

  if (credentials) {
    view.links.push({ label: `Open ${preview.name} setup`, href: method.setup_url })
    view.details = {
      label: 'Show setup instructions', instructions: method.setup?.instructions ?? [],
      values: [
        ...Object.entries(method.setup?.values ?? {}).map(([label, value]) => ({ label, value })),
        ...(methodId === 'oauth' ? [{ label: 'Redirect URI', value: 'http://127.0.0.1:1337/api/v1/connections/oauth/callback' }] : [])
      ].map((item) => ({ ...item, copyLabel: `Copy ${item.label.toLowerCase()}` }))
    }
    view.fields = Object.entries(methodId === 'oauth' && oauthConfigured ? {} : method.settings).map(([name, value]) => ({
      name, label: name === 'client_id' ? 'Client ID' : StringHelper.ucFirst(name.split('_').join(' ')),
      type: name === 'client_id' ? 'text' : 'password', required: value === null, value: '', maxLength: 4_096
    }))
    view.actions.push({ id: Action.Connect, label: `Connect ${preview.name}`, submit: true })
    view.actions.push({ id: Action.SelectMethod, label: 'Back', secondary: true })
    if (needsApplication && step !== Step.Assisted) {
      view.actions.push({ id: Action.StartSetup, label: 'Set it up for me', secondary: true })
    }
  } else {
    view.actions.push({ id: methodId === 'oauth' && !needsApplication ? Action.Connect : Action.Credentials,
      label: `Connect ${preview.name}` })
  }

  return view
}
