import { beforeEach, describe, expect, it, vi } from 'vitest'

import Persona from '@/core/llm-manager/persona'
import AmbientConditionsManager from '@/core/ambient-conditions-manager'
import { ToolExecutionOrigin } from '@/types'
import Fastify from 'fastify'
import { getAmbientConditions } from '@/core/http-server/api/ambient/get'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSnapshot: vi.fn(),
  owner: {} as Record<string, string>,
  timeZone: 'UTC',
  mood: 'sad'
}))

vi.mock('@/core', () => ({
  EVENT_EMITTER: {},
  SOCKET_SERVER: null,
  TOOLKIT_REGISTRY: { isLoaded: true },
  TOOL_EXECUTOR: { executeTool: mocks.execute },
  AMBIENT_CONDITIONS_MANAGER: { getSnapshot: mocks.getSnapshot },
  PERSONA: {
    get mood(): { type: string } {
      return { type: mocks.mood }
    }
  }
}))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {} }))
vi.mock('@/core/context-manager/owner-profile', () => ({
  readOwnerProfileSync: (): Record<string, string> => mocks.owner
}))
vi.mock('@/helpers/date-helper', () => ({
  DateHelper: { getTimeZone: (): string => mocks.timeZone }
}))
vi.mock('@/core/context-manager/context-state-store', () => ({
  ContextStateStore: class {
    load(): { locationQuery: null, weather: null } {
      return { locationQuery: null, weather: null }
    }

    save(): void {
      return
    }
  }
}))

interface WeatherPersona {
  refreshWeatherSnapshot(): Promise<void>
  weatherSnapshot: unknown
}

it('returns the current persona mood with ambient conditions rather than a cached mood', async () => {
  const app = Fastify()
  mocks.getSnapshot.mockResolvedValue({ season: 'autumn' })
  await app.register(getAmbientConditions, { apiVersion: 'v1' })
  try {
    mocks.mood = 'sad'
    expect((await app.inject('/api/v1/ambient')).json().ambient.mood).toBe('sad')
    mocks.mood = 'cocky'
    expect((await app.inject('/api/v1/ambient')).json().ambient.mood).toBe('cocky')
  } finally {
    await app.close()
  }
})

describe('ambient weather grounding', () => {
  beforeEach(() => {
    mocks.owner = {}
    mocks.timeZone = 'UTC'
    mocks.execute.mockResolvedValue({ status: 'error' })
  })

  it.each(['UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+8'])(
    'does not geocode a non-geographic timezone (%s)',
    async (timeZone) => {
      mocks.timeZone = timeZone
      const ambient = await new AmbientConditionsManager().getSnapshot()

      expect(mocks.execute).not.toHaveBeenCalled()
      expect(ambient.weather).toBeNull()
    }
  )

  it('prefers the owner location and attributes ambient calls to persona', async () => {
    mocks.owner = { owner_current_city: 'Shenzhen', owner_current_country: 'China' }
    await new AmbientConditionsManager().getSnapshot()

    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      origin: ToolExecutionOrigin.Persona,
      parsedInput: { location: 'Shenzhen, China' }
    }))
  })

  it('uses the shared ambient snapshot for persona weather', async () => {
    const weather = { description: 'Clear', temperatureC: 24 }
    mocks.getSnapshot.mockResolvedValue({ weather })
    const persona = Object.create(Persona.prototype) as WeatherPersona

    await persona.refreshWeatherSnapshot()

    expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith()
    expect(persona.weatherSnapshot).toBe(weather)
  })
})
