export interface MessagingAppConfig {
  [key: string]: string | number | boolean | null | undefined
}

export interface MessagingAppBroadcastPayload {
  message: string
  messageId?: string
}

export interface MessagingAppIncomingMessage {
  message: string
  conversationId: string
  senderId: string
  messageId?: string
  metadata?: Record<string, unknown>
}

export interface MessagingAppState {
  name: string
  displayName: string
  isEnabled: boolean
  isConfigured: boolean
  supportedConfigKeys: string[]
  requiredConfigKeys: string[]
}
