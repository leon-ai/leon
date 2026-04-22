import { DiscordMessagingApp } from '@/messaging/discord-messaging-app'
import { EmailMessagingApp } from '@/messaging/email-messaging-app'
import { MessagingApp } from '@/messaging/messaging-app'
import { SlackMessagingApp } from '@/messaging/slack-messaging-app'
import { TelegramMessagingApp } from '@/messaging/telegram-messaging-app'
import { WhatsAppMessagingApp } from '@/messaging/whatsapp-messaging-app'

export * from '@/messaging/types'
export * from '@/messaging/messaging-app'
export * from '@/messaging/messaging-app-manager'
export * from '@/messaging/telegram-messaging-app'
export * from '@/messaging/whatsapp-messaging-app'
export * from '@/messaging/discord-messaging-app'
export * from '@/messaging/slack-messaging-app'
export * from '@/messaging/email-messaging-app'

export function createDefaultMessagingApps(): MessagingApp[] {
  return [
    new TelegramMessagingApp(),
    new WhatsAppMessagingApp(),
    new DiscordMessagingApp(),
    new SlackMessagingApp(),
    new EmailMessagingApp()
  ]
}
