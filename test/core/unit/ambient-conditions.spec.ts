import { beforeEach, afterEach, expect, it, vi } from 'vitest'

import AmbientConditionsManager, { AmbientWeatherCondition, type AmbientWeatherSnapshot } from '@/core/ambient-conditions-manager'

const fixture = vi.hoisted(() => ({
  cache: null as { locationQuery: string | null, weather: AmbientWeatherSnapshot | null } | null,
  weather: {
    success: true,
    data: {
      timezone: 'Europe/Paris',
      location: 'Test town',
      current: { weatherCode: 0, temperatureC: '20', feelsLikeC: '19', observationTime: '2026-10-30T12:00' },
      daily: {
        time: ['2026-10-30'], sunrise: ['2026-10-30T07:00'] as (string | null)[],
        sunset: ['2026-10-30T19:00'] as (string | null)[]
      }
    }
  },
  execute: vi.fn()
}))

vi.mock('@/core', () => ({
  TOOLKIT_REGISTRY: { isLoaded: true },
  TOOL_EXECUTOR: { executeTool: fixture.execute }
}))
vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): object => ({ time_zone: 'UTC' }) } }))
vi.mock('@/core/context-manager/owner-profile', () => ({
  readOwnerProfileSync: (): object => ({ owner_current_city: 'Test town' })
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), success: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/core/context-manager/context-state-store', () => ({
  ContextStateStore: class {
    public load(): object {
      return fixture.cache ?? { locationQuery: null, weather: null }
    }

    public save(value: typeof fixture.cache): void {
      fixture.cache = value
    }
  }
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
  fixture.cache = null
  fixture.weather.data.timezone = 'Europe/Paris'
  fixture.weather.data.daily = {
    time: ['2026-10-30'], sunrise: ['2026-10-30T07:00'], sunset: ['2026-10-30T19:00']
  }
  fixture.execute.mockImplementation(async (): Promise<object> => ({
    status: 'success', data: { output: { result: fixture.weather } }
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

it.each([
  ['2026-10-30T04:00:00Z', 'night'],
  ['2026-10-30T05:45:00Z', 'sunrise'],
  ['2026-10-30T07:00:00Z', 'morning'],
  ['2026-10-30T12:00:00Z', 'noon'],
  ['2026-10-30T16:00:00Z', 'afternoon'],
  ['2026-10-30T17:45:00Z', 'sunset'],
  ['2026-10-30T18:45:00Z', 'blue-hour'],
  ['2026-10-30T19:30:00Z', 'night']
])('derives %s from the weather location solar events as %s', async (timestamp, phase) => {
  const manager = new AmbientConditionsManager()
  const snapshot = await manager.getSnapshot(new Date(timestamp))
  expect(snapshot.solarPhase).toBe(phase)
  expect(snapshot.timeZone).toBe('Europe/Paris')
  expect(snapshot.weather?.solar).toEqual({
    date: '2026-10-30', timeZone: 'Europe/Paris',
    sunrise: Date.parse('2026-10-30T06:00:00Z'), sunset: Date.parse('2026-10-30T18:00:00Z')
  })
  const restored = new AmbientConditionsManager()
  expect((await restored.getSnapshot(new Date(timestamp))).solarPhase).toBe(phase)
  expect(fixture.execute).toHaveBeenCalledTimes(1)
})

it.each(['missing', 'polar', 'invalid-zone', 'invalid-time', 'reversed', 'wrong-day'])(
  'keeps usable weather with clock-based phases when solar data is %s', async (kind) => {
    const data = fixture.weather.data
    if (kind === 'missing') {
      data.daily.sunrise = []
    } else if (kind === 'polar') {
      data.daily.sunrise = [null]
      data.daily.sunset = [null]
    } else if (kind === 'invalid-zone') {
      data.timezone = 'Not/AZone'
    } else if (kind === 'invalid-time') {
      data.daily.sunset = ['not-a-time']
    } else if (kind === 'reversed') {
      data.daily.sunset = ['2026-10-30T06:00']
    } else {
      data.daily.time = ['2026-10-29']
    }
    const manager = new AmbientConditionsManager()
    const snapshot = await manager.getSnapshot()
    expect(snapshot.weather?.temperatureC).toBe(20)
    expect(snapshot.weather?.solar).toBeNull()
    expect(snapshot.solarPhase).toBe('noon')
    expect(snapshot.timeZone).toBe('UTC')
    await manager.getSnapshot()
    expect(fixture.execute).toHaveBeenCalledTimes(1)
  }
)

it('refreshes cached weather when solar availability has not been checked', async () => {
  fixture.cache = {
    locationQuery: 'Test town', weather: {
      condition: AmbientWeatherCondition.Clear, description: 'Clear', temperatureC: 20,
      feelsLikeC: 19, fetchedAt: Date.now(), location: 'Test town',
      observationTime: '2026-10-30T12:00', weatherCode: 0
    }
  }
  const snapshot = await new AmbientConditionsManager().getSnapshot()
  expect(snapshot.weather?.solar?.date).toBe('2026-10-30')
  expect(fixture.execute).toHaveBeenCalledTimes(1)
})

it('refreshes the solar date at local midnight even while cached weather is less than an hour old', async () => {
  vi.setSystemTime(new Date('2026-10-30T22:45:00Z'))
  const manager = new AmbientConditionsManager()
  await manager.getSnapshot()
  vi.setSystemTime(new Date('2026-10-30T23:05:00Z'))
  fixture.weather.data.daily = {
    time: ['2026-10-31'], sunrise: ['2026-10-31T07:01'], sunset: ['2026-10-31T18:59']
  }
  const snapshot = await manager.getSnapshot()
  expect(snapshot.weather?.solar?.date).toBe('2026-10-31')
  expect(fixture.execute).toHaveBeenCalledTimes(2)
})

it('does not use yesterday solar events when a weather refresh fails', async () => {
  vi.setSystemTime(new Date('2026-10-30T22:45:00Z'))
  const manager = new AmbientConditionsManager()
  await manager.getSnapshot()
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
  fixture.execute.mockRejectedValue(new Error('Weather temporarily unavailable'))
  const snapshot = await manager.getSnapshot()
  expect(snapshot.weather?.solar?.date).toBe('2026-10-30')
  expect(snapshot.solarPhase).toBe('noon')
})

it.each([
  ['Europe/Paris', '2026-03-29', '2026-03-29T05:00:00Z'],
  ['Europe/Paris', '2026-10-25', '2026-10-25T06:00:00Z'],
  ['Pacific/Auckland', '2026-01-15', '2026-01-14T18:00:00Z']
])('interprets sunrise in %s on %s independently of the server timezone', async (timeZone, date, instant) => {
  vi.setSystemTime(new Date(instant))
  fixture.weather.data.timezone = timeZone
  fixture.weather.data.daily = {
    time: [date], sunrise: [`${date}T07:00`], sunset: [`${date}T19:00`]
  }
  const snapshot = await new AmbientConditionsManager().getSnapshot()
  expect(snapshot.solarPhase).toBe('sunrise')
  expect(snapshot.weather?.solar?.sunrise).toBe(Date.parse(instant))
})
