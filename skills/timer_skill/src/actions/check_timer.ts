import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { TimerWidget } from '../widgets/timer-widget'
import { getTimerMemoryByWidgetId, getNewestTimerMemory } from '../lib/memory'

export const run: ActionFunction = async function (_params, paramsHelper) {
  const widgetId = paramsHelper.getWidgetId()
  const timerMemory = widgetId
    ? await getTimerMemoryByWidgetId(widgetId)
    : await getNewestTimerMemory()

  if (!timerMemory) {
    return await leon.answer({ key: 'no_timer_set' })
  }

  const { interval, finishedAt, duration } = timerMemory
  let remainingTime = finishedAt - Math.floor(Date.now() / 1_000)
  if (remainingTime <= 0) {
    remainingTime = 0
  }
  const initialProgress = 100 - (remainingTime / duration) * 100

  const timerWidget = new TimerWidget({
    params: {
      seconds: remainingTime,
      initialProgress,
      initialDuration: duration,
      interval
    },
    onFetch: {
      widgetId: widgetId ?? timerMemory.widgetId,
      actionName: 'check_timer'
    }
  })

  await leon.answer({ widget: timerWidget })
}
