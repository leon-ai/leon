import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

interface ProfileRuntimeEntry {
  profileName: string
  services: Map<string, object>
  lastAccessedAt: number
  initializationPromise: Promise<void> | null
}

export interface ProfileRuntimeSummary {
  profileName: string
  serviceCount: number
  lastAccessedAt: number
}

class ProfileRuntimeManager {
  private readonly runtimes = new Map<string, ProfileRuntimeEntry>()

  /** Lazily create a service once for the active profile. */
  public getService<T extends object>(
    serviceName: string,
    factory: () => T
  ): T {
    const profileName = getActiveProfileName()
    const runtime = this.getRuntime(profileName)
    const existingService = runtime.services.get(serviceName)

    runtime.lastAccessedAt = Date.now()

    if (existingService) {
      return existingService as T
    }

    const service = factory()

    runtime.services.set(serviceName, service)

    return service
  }

  public listRuntimes(): ProfileRuntimeSummary[] {
    return [...this.runtimes.values()].map((runtime) => ({
      profileName: runtime.profileName,
      serviceCount: runtime.services.size,
      lastAccessedAt: runtime.lastAccessedAt
    }))
  }

  /** Ensure asynchronous profile services initialize only once under concurrency. */
  public async ensureInitialized(initializer: () => Promise<void>): Promise<void> {
    const runtime = this.getRuntime(getActiveProfileName())

    if (!runtime.initializationPromise) {
      runtime.initializationPromise = initializer().catch((error) => {
        runtime.initializationPromise = null
        throw error
      })
    }

    await runtime.initializationPromise
    runtime.lastAccessedAt = Date.now()
  }

  private getRuntime(profileName: string): ProfileRuntimeEntry {
    const existingRuntime = this.runtimes.get(profileName)

    if (existingRuntime) {
      return existingRuntime
    }

    const runtime: ProfileRuntimeEntry = {
      profileName,
      services: new Map(),
      lastAccessedAt: Date.now(),
      initializationPromise: null
    }

    this.runtimes.set(profileName, runtime)

    return runtime
  }
}

export const PROFILE_RUNTIME_MANAGER = new ProfileRuntimeManager()

/** Expose a familiar singleton API backed by one lazy instance per profile. */
export function createProfileServiceProxy<T extends object>(
  serviceName: string,
  factory: () => T,
  scopeKey?: () => string | null
): T {
  return new Proxy({} as T, {
    get: (_target, property): unknown => {
      const resolvedScopeKey = scopeKey?.()
      const resolvedServiceName = resolvedScopeKey
        ? `${serviceName}:${resolvedScopeKey}`
        : serviceName
      const service = PROFILE_RUNTIME_MANAGER.getService(
        resolvedServiceName,
        factory
      )
      const value = Reflect.get(service, property)

      return typeof value === 'function' ? value.bind(service) : value
    },
    set: (_target, property, value): boolean => {
      const resolvedScopeKey = scopeKey?.()
      const resolvedServiceName = resolvedScopeKey
        ? `${serviceName}:${resolvedScopeKey}`
        : serviceName
      const service = PROFILE_RUNTIME_MANAGER.getService(
        resolvedServiceName,
        factory
      )

      return Reflect.set(service, property, value)
    }
  })
}
