import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage
} from '@/messaging/types'

interface WhatsAppMessagingAppConfig extends MessagingAppConfig {
  accessToken: string
  phoneNumberId: string
  recipientPhoneNumber: string
}

const WHATSAPP_CONFIG_KEYS: Array<keyof WhatsAppMessagingAppConfig & string> = [
  'accessToken',
  'phoneNumberId',
  'recipientPhoneNumber'
]

export class WhatsAppMessagingApp extends MessagingApp<WhatsAppMessagingAppConfig> {
  public readonly name = 'whatsapp'
  public readonly displayName = 'WhatsApp'
  public readonly supportedConfigKeys = WHATSAPP_CONFIG_KEYS
  public readonly requiredConfigKeys = WHATSAPP_CONFIG_KEYS

  public override async handleIncomingMessage(
    payload: MessagingAppIncomingMessage
  ): Promise<void> {
    void payload
    this.logPendingImplementation('handleIncomingMessage')
  }

  protected override async sendMessage(
    payload: MessagingAppBroadcastPayload
  ): Promise<void> {
    void payload
    this.logPendingImplementation('sendMessage')
  }
}
