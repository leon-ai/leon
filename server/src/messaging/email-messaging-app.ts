import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage
} from '@/messaging/types'

interface EmailMessagingAppConfig extends MessagingAppConfig {
  smtpHost: string
  smtpPort: number
  username: string
  password: string
  from: string
  to: string
}

const EMAIL_CONFIG_KEYS: Array<keyof EmailMessagingAppConfig & string> = [
  'smtpHost',
  'smtpPort',
  'username',
  'password',
  'from',
  'to'
]

export class EmailMessagingApp extends MessagingApp<EmailMessagingAppConfig> {
  public readonly name = 'email'
  public readonly displayName = 'Email'
  public readonly supportedConfigKeys = EMAIL_CONFIG_KEYS
  public readonly requiredConfigKeys = EMAIL_CONFIG_KEYS

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
