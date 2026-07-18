import { PROFILE_RUNTIME_MANAGER } from '@/core/profile-runtime/profile-runtime-manager'
import { CONFIG_STATE } from '@/core/config-states/config-state'

/** Initialize only the services required to accept agent turns for a profile. */
export async function ensureActiveProfileRuntime(): Promise<void> {
  await PROFILE_RUNTIME_MANAGER.ensureInitialized(async () => {
    const { LLM_MANAGER, LLM_PROVIDER, PULSE_MANAGER } = await import('@/core')
    PULSE_MANAGER.start()
    const hasEnabledTarget = CONFIG_STATE.getModelState().hasEnabledTarget()

    if (!hasEnabledTarget) {
      return
    }

    if (!LLM_PROVIDER.isLLMProviderReady) {
      const isProviderReady = await LLM_PROVIDER.init()

      if (!isProviderReady) {
        return
      }
    }

    if (!LLM_MANAGER.isLLMEnabled) {
      await LLM_MANAGER.init()
    }
  })
}
