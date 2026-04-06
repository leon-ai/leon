import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage
} from '@/messaging/types'

interface TelegramMessagingAppConfig extends MessagingAppConfig {
  botToken: string
  chatId: string
}

const TELEGRAM_CONFIG_KEYS: Array<keyof TelegramMessagingAppConfig & string> = [
  'botToken',
  'chatId'
]

export class TelegramMessagingApp extends MessagingApp<TelegramMessagingAppConfig> {
  public readonly name = 'telegram'
  public readonly displayName = 'Telegram'
  public readonly supportedConfigKeys = TELEGRAM_CONFIG_KEYS
  public readonly requiredConfigKeys = TELEGRAM_CONFIG_KEYS

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
