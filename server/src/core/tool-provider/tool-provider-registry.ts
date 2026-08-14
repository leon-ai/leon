import type {
  ToolProvider,
  ToolProviderExecutionInput,
  ToolProviderExecutionResult
} from '@/core/tool-provider/types'

/** Owns persistent tool providers independently from short-lived tool workers. */
export class ToolProviderRegistry {
  private readonly providers = new Map<string, ToolProvider>()

  public register(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Tool provider "${provider.id}" is already registered.`)
    }

    this.providers.set(provider.id, provider)
  }

  public async execute(
    providerId: string,
    input: ToolProviderExecutionInput
  ): Promise<ToolProviderExecutionResult> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      return {
        success: false,
        message: `Tool provider "${providerId}" is not available.`,
        output: {}
      }
    }

    return provider.execute(input)
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.providers.values()].map((provider) => provider.dispose())
    )
  }
}
