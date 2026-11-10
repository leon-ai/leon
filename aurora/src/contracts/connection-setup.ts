export enum ConnectionSetupActionId {
  Refresh = 'refresh',
  Install = 'install',
  Enable = 'enable',
  SelectMethod = 'select_method',
  Manual = 'manual',
  Credentials = 'credentials',
  StartSetup = 'start_setup',
  Connect = 'connect',
  Continue = 'continue'
}

export enum ConnectionSetupStep {
  Choice = 'choice',
  Installation = 'installation',
  Disabled = 'disabled',
  Application = 'application',
  Credentials = 'credentials',
  Assisted = 'assisted',
  Connected = 'connected',
  Continued = 'continued'
}

export const CONNECTION_SETUP_MESSAGES = {
  loadError: 'I couldn’t load connection setup. Please try again.',
  actionError: 'I couldn’t complete this step. Check the setup fields and account permissions, then try again.',
  popupBlocked: 'Allow pop-ups for this site, then try connecting again.',
  retry: 'Retry',
  copied: 'Copied',
  copyFailed: 'Select and copy the text above.'
}

export const CONNECTION_AUTHORIZATION_CHANNEL = 'leon:connection-authorization:'

export interface ConnectionAuthorizationCompletion {
  id: string
  provider: string
  result: 'connected' | 'failed'
}

/**
 * Prefers provider authorization over manually handled tokens. Missing OAuth
 * application credentials are a setup prerequisite, not an unavailable method.
 */
export function getPreferredConnectionMethod<T extends { id: string }>(
  methods: readonly T[]
): T | undefined {
  return methods.find((method) => method.id === 'oauth') ??
    methods.find((method) => method.id === 'api_key')
}

export interface ConnectionSetupAction {
  id: string
  label: string
  method?: string
  secondary?: boolean
  submit?: boolean
}

export interface ConnectionSetupView {
  state: { method: string, step: string }
  tool?: { name: string, description: string }
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
  messages: typeof CONNECTION_SETUP_MESSAGES
}

export interface ConnectionSetupDescriptor {
  provider: string
  name?: string
  description?: string
  iconName?: string
  logoUrl?: string
}

export interface ConnectionSetupResult {
  view: ConnectionSetupView
  event?: {
    methodName: 'send_utterance'
    methodParams: { from: 'owner', utterance: string }
    session_id: string
  }
  authorization_url?: string
}
