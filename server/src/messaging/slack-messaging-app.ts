import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage
} from '@/messaging/types'

interface SlackMessagingAppConfig extends MessagingAppConfig {
  botToken: string
  channelId: string
}

const SLACK_CONFIG_KEYS: Array<keyof SlackMessagingAppConfig & string> = [
  'botToken',
  'channelId'
]

export class SlackMessagingApp extends MessagingApp<SlackMessagingAppConfig> {
  public readonly name = 'slack'
  public readonly displayName = 'Slack'
  public readonly supportedConfigKeys = SLACK_CONFIG_KEYS
  public readonly requiredConfigKeys = SLACK_CONFIG_KEYS

  public override async handleIncomingMessage(
    payload: MessagingAppIncomingMessage
  ): Promise<void> {
    await this.forwardIncomingMessage(payload)
  }

  protected override async sendMessage(
    payload: MessagingAppBroadcastPayload
  ): Promise<void> {
    void payload
    this.logPendingImplementation('sendMessage')
  }
}
