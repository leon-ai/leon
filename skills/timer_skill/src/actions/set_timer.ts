import type { ActionFunction, BuiltInDurationEntity } from '@sdk/types'
import { leon } from '@sdk/leon'

import { TimerWidget } from '../widgets/timer-widget'
import { createTimerMemory } from '../lib/memory'

export const run: ActionFunction = async function (_params, paramsHelper) {
  const supportedUnits = ['hours', 'minutes', 'seconds']
  const durationEntity = paramsHelper.findLastEntity('duration')
  const [duration] =
    (
      durationEntity?.resolution as
        | BuiltInDurationEntity['resolution']
        | undefined
    )?.values ?? []

  if (!duration) {
    return leon.answer({ key: 'cannot_get_duration' })
  }

  const { unit } = duration
  if (!supportedUnits.includes(unit)) {
    return leon.answer({ key: 'unit_not_supported' })
  }

  const { value: durationValue } = duration
  const seconds = Number(durationValue)
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
