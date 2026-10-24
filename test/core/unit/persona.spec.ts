import { beforeEach, describe, expect, it, vi } from 'vitest'

import Persona from '@/core/llm-manager/persona'
import { ToolExecutionOrigin } from '@/types'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  owner: {} as Record<string, string>
}))

vi.mock('@/core', () => ({
  EVENT_EMITTER: {},
  SOCKET_SERVER: null,
  TOOLKIT_REGISTRY: { isLoaded: true },
  TOOL_EXECUTOR: { executeTool: mocks.execute }
}))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {} }))
vi.mock('@/core/context-manager/owner-profile', () => ({
  readOwnerProfileSync: (): Record<string, string> => mocks.owner
}))

interface WeatherPersona {
  refreshWeatherSnapshot(): Promise<void>
  weatherSnapshot: unknown
  weatherCacheStore: { load(): unknown }
}

describe('persona weather grounding', () => {
  beforeEach(() => {
    mocks.owner = {}
    mocks.execute.mockResolvedValue({ status: 'error' })
  })

  it.each(['UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+8'])(
    'does not geocode a non-geographic timezone (%s)',
    async (timeZone) => {
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        timeZone
      } as Intl.ResolvedDateTimeFormatOptions)
      const persona = Object.create(Persona.prototype) as WeatherPersona

      await persona.refreshWeatherSnapshot()

      expect(mocks.execute).not.toHaveBeenCalled()
      expect(persona.weatherSnapshot).toBeNull()
    }
  )

  it('prefers the owner location and attributes ambient calls to persona', async () => {
    mocks.owner = { owner_current_city: 'Shenzhen', owner_current_country: 'China' }
    const persona = Object.create(Persona.prototype) as WeatherPersona
    persona.weatherCacheStore = { load: (): { snapshot: null } => ({ snapshot: null }) }

    await persona.refreshWeatherSnapshot()

    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      origin: ToolExecutionOrigin.Persona,
      parsedInput: { location: 'Shenzhen, China' }
    }))
  })
})
