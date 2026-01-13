import { Memory } from '@sdk/memory'

export interface TimerMemory {
  widgetId: string
  duration: number
  interval: number
  createdAt: number
  finishedAt: number
}

const TIMERS_MEMORY = new Memory<TimerMemory[]>({
  name: 'timers',
  defaultMemory: []
})

export async function createTimerMemory(
  widgetId: string,
  duration: number,
  interval: number
): Promise<TimerMemory> {
  const createdAt = Math.floor(Date.now() / 1_000)
  const newTimerMemory: TimerMemory = {
    duration,
    widgetId,
    interval,
    createdAt,
    finishedAt: createdAt + duration
  }

  const timersMemory = await TIMERS_MEMORY.read()
  await TIMERS_MEMORY.write([...timersMemory, newTimerMemory])

  return newTimerMemory
}

export async function getTimerMemoryByWidgetId(
  widgetId: string
): Promise<TimerMemory | null> {
  const timersMemory = await TIMERS_MEMORY.read()

  return (
    timersMemory.find((timerMemory) => timerMemory.widgetId === widgetId) ||
    null
  )
}

export async function getNewestTimerMemory(): Promise<TimerMemory | null> {
  const timersMemory = await TIMERS_MEMORY.read()

  return timersMemory[timersMemory.length - 1] || null
}

export function deleteAllTimersMemory(): Promise<TimerMemory[]> {
  return TIMERS_MEMORY.write([])
}
