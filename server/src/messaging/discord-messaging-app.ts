import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage
} from '@/messaging/types'

interface DiscordMessagingAppConfig extends MessagingAppConfig {
  botToken: string
  channelId: string
}

const DISCORD_CONFIG_KEYS: Array<keyof DiscordMessagingAppConfig & string> = [
  'botToken',
  'channelId'
]

export class DiscordMessagingApp extends MessagingApp<DiscordMessagingAppConfig> {
  public readonly name = 'discord'
  public readonly displayName = 'Discord'
  public readonly supportedConfigKeys = DISCORD_CONFIG_KEYS
  public readonly requiredConfigKeys = DISCORD_CONFIG_KEYS

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
