import notion from '../../tools/productivity_collaboration/notion/tool.json' with { type: 'json' }
import spotify from '../../tools/music_audio/spotify/tool.json' with { type: 'json' }
import ticktick from '../../tools/productivity_collaboration/ticktick/tool.json' with { type: 'json' }
import { ConnectionSetupActionId as Action, ConnectionSetupStep as Step, CONNECTION_SETUP_MESSAGES,
  type ConnectionSetupView } from '../../aurora/src/contracts/connection-setup'

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
  iconName: string
  methods: Record<string, PreviewMethod>
}

export const CONNECTION_PREVIEWS: Record<string, ConnectionPreview> = {
  'connection-notion': { provider: `${notion.toolkit_id}.${notion.tool_id}`, name: notion.name, iconName: notion.icon_name, methods: {
    oauth: { name: 'OAuth', description: 'Sign in through Notion’s official MCP server.',
      setup_url: 'https://developers.notion.com/guides/mcp/get-started-with-mcp', settings: {} }
  } },
  'connection-spotify': { provider: `${spotify.toolkit_id}.${spotify.tool_id}`, name: spotify.name, iconName: spotify.icon_name, methods: spotify.connection.methods },
  'connection-ticktick': { provider: `${ticktick.toolkit_id}.${ticktick.tool_id}`, name: ticktick.name, iconName: ticktick.icon_name, methods: ticktick.connection.methods }
}

export const CONNECTION_PREVIEW_STATES = [
  { value: Step.Choice, label: 'Start' },
  { value: Step.Application, label: 'Setup instructions' },
  { value: Step.Credentials, label: 'Connection fields' },
  { value: Step.Assisted, label: 'Guided setup' },
  { value: 'authorizing', label: 'Authorizing' },
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
  const credentials = step === Step.Credentials || step === 'failed'
  const application = step === Step.Application
  const view: ConnectionSetupView = {
    state: { method: methodId, step }, title: connected ? preview.name : `Set up ${preview.name}`,
    description: connected ? 'This is a local preview. No account was connected.' :
      step === Step.Assisted ? 'You can follow setup progress in the conversation.' :
        needsApplication ? 'A one-time application setup is needed before you can authorize access. Enter its credentials to get started.' :
          methodId === 'oauth' ? 'Authorize access on the provider’s website. You stay in control of your permissions.' : method.description,
    fields: [], links: [], actions: [], messages: CONNECTION_SETUP_MESSAGES,
    ...(connected ? { status: 'Connected — preview only' } : {}),
    ...(step === 'cancelled' ? { notice: 'Authorization was cancelled. You can start again when you’re ready.' } : {})
  }

  if (connected) {
    view.actions.push({ id: Action.Continue, label: 'Continue' })
    return view
  }

  if (credentials || application) {
    view.links.push({ label: `Open ${preview.name} setup`, href: method.setup_url })
    view.details = {
      label: 'Show setup instructions', instructions: method.setup?.instructions ?? [],
      values: [
        ...Object.entries(method.setup?.values ?? {}).map(([label, value]) => ({ label, value })),
        ...(methodId === 'oauth' ? [{ label: 'Redirect URI', value: 'http://127.0.0.1:1337/api/v1/connections/oauth/callback' }] : [])
      ].map((item) => ({ ...item, copyLabel: `Copy ${item.label.toLowerCase()}` }))
    }
    if (application) {
      view.actions.push({ id: Action.Credentials, label: 'I have my application credentials' })
    } else {
      view.fields = Object.entries(methodId === 'oauth' && oauthConfigured ? {} : method.settings).map(([name, value]) => ({
        name, label: name === 'client_id' ? 'Client ID' : name.split('_').join(' '),
        type: name === 'client_id' ? 'text' : 'password', required: value === null, value: '', maxLength: 4_096
      }))
      view.actions.push({ id: Action.Connect, label: `Connect ${preview.name}`, submit: true })
    }
    if (needsApplication) {
      view.actions.push({ id: Action.StartSetup, label: 'Set it up for me', secondary: true })
    }
  } else {
    if (step !== Step.Assisted) {
      view.actions.push({ id: methodId === 'oauth' && !needsApplication ? Action.Connect : Action.Credentials,
        label: `Connect ${preview.name}` })
    }
    if (step === Step.Assisted) {
      view.actions.push({ id: Action.Manual, label: 'Set up manually', secondary: true })
    }
  }

  return view
}
