import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { TimerWidget } from '../widgets/timer-widget'
import { createTimerMemory } from '../lib/memory'

interface TimerDuration {
  value?: number
  unit?: string
}

export const run: ActionFunction = async function (params) {
  const supportedUnits = ['hours', 'minutes', 'seconds']
  const duration = (params.action_arguments['duration'] as TimerDuration) || null

  if (
    !duration ||
    typeof duration.value !== 'number' ||
    typeof duration.unit !== 'string'
  ) {
    await leon.answer({ key: 'cannot_get_duration' })
    return
  }

  const normalizedUnit = duration.unit.toLowerCase()
  if (!supportedUnits.includes(normalizedUnit)) {
    await leon.answer({ key: 'unit_not_supported' })
    return
  }

  const { value: durationValue } = duration
  const seconds =
    normalizedUnit === 'hours'
      ? Number(durationValue) * 3_600
      : normalizedUnit === 'minutes'
        ? Number(durationValue) * 60
        : Number(durationValue)
  const interval = 1_000
  const timerWidget = new TimerWidget({
    params: {
      seconds,
      initialProgress: 0,
      interval
    },
    onFetch: {
      actionName: 'check_timer'
    }
  })

  await Promise.all([
    createTimerMemory(timerWidget.id, seconds, interval),
    leon.answer({
      widget: timerWidget,
      key: 'timer_set'
    })
  ])
}
