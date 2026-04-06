import { LogHelper } from '@/helpers/log-helper'
import type {
  MessagingAppBroadcastPayload,
  MessagingAppConfig,
  MessagingAppIncomingMessage,
  MessagingAppState
} from '@/messaging/types'

export abstract class MessagingApp<
  TConfig extends MessagingAppConfig = MessagingAppConfig
> {
  protected config: Partial<TConfig> = {}
  private enabled = false

  public abstract readonly name: string
  public abstract readonly displayName: string
  public abstract readonly supportedConfigKeys: readonly (keyof TConfig & string)[]
  public abstract readonly requiredConfigKeys: readonly (keyof TConfig & string)[]

  public enable(): void {
    this.enabled = true
  }

  public disable(): void {
    this.enabled = false
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public configure(config: Partial<TConfig>): void {
    this.config = {
      ...this.config,
      ...config
    }
  }

  public clearConfiguration(): void {
    this.config = {}
    this.disable()
  }

  public getConfig(): Partial<TConfig> {
    return {
      ...this.config
    }
  }

  public isConfigured(): boolean {
    return this.requiredConfigKeys.every((requiredConfigKey) =>
      this.hasConfigValue(requiredConfigKey)
    )
  }

  public getState(): MessagingAppState {
    return {
      name: this.name,
      displayName: this.displayName,
      isEnabled: this.isEnabled(),
      isConfigured: this.isConfigured(),
      supportedConfigKeys: [...this.supportedConfigKeys],
      requiredConfigKeys: [...this.requiredConfigKeys]
    }
  }

  public async broadcast(
    payload: MessagingAppBroadcastPayload
  ): Promise<void> {
    if (!this.isEnabled() || !this.isConfigured()) {
      return
    }

    const normalizedMessage = payload.message.trim()
    if (!normalizedMessage) {
      return
    }

    await this.sendMessage({
      ...payload,
      message: normalizedMessage
    })
  }

  protected hasConfigValue(key: keyof TConfig): boolean {
    const value = this.config[key]

    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return value !== null && typeof value !== 'undefined'
  }

  protected logPendingImplementation(methodName: string): void {
    LogHelper.title('Messaging')
    LogHelper.info(
      `[${this.displayName}] ${methodName} is ready for implementation.`
    )
  }

  public abstract handleIncomingMessage(
    payload: MessagingAppIncomingMessage
  ): Promise<void>

  protected abstract sendMessage(
    payload: MessagingAppBroadcastPayload
  ): Promise<void>
}
