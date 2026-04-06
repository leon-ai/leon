import { LogHelper } from '@/helpers/log-helper'
import { MessagingApp } from '@/messaging/messaging-app'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage,
  MessagingAppState
} from '@/messaging/types'

export class MessagingAppManager {
  private readonly apps = new Map<string, MessagingApp>()

  public constructor(apps: MessagingApp[] = []) {
    apps.forEach((app) => {
      this.register(app)
    })
  }

  public register(app: MessagingApp): void {
    this.apps.set(app.name, app)
  }

  public list(): MessagingAppState[] {
    return [...this.apps.values()].map((app) => app.getState())
  }

  public get(name: string): MessagingApp | null {
    return this.apps.get(name) || null
  }

  public enable(name: string): boolean {
    const app = this.get(name)
    if (!app) {
      return false
    }

    app.enable()

    return true
  }

  public disable(name: string): boolean {
    const app = this.get(name)
    if (!app) {
      return false
    }

    app.disable()

    return true
  }

  public configure(name: string, config: MessagingAppConfig): boolean {
    const app = this.get(name)
    if (!app) {
      return false
    }

    app.configure(config)
    app.enable()

    return true
  }

  public async broadcast(
    payload: MessagingAppBroadcastPayload
  ): Promise<void> {
    for (const app of this.apps.values()) {
      try {
        await app.broadcast(payload)
      } catch (error) {
        LogHelper.title('Messaging')
        LogHelper.error(
          `Failed to broadcast message to "${app.name}": ${String(error)}`
        )
      }
    }
  }

  public async handleIncomingMessage(
    appName: string,
    payload: MessagingAppIncomingMessage
  ): Promise<void> {
    const app = this.get(appName)
    if (!app) {
      throw new Error(`Unknown messaging app: ${appName}`)
    }

    await app.handleIncomingMessage(payload)
  }
}
