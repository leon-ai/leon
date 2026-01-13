import type { WidgetComponent } from '@sdk/widget-component'
import { Widget, type WidgetEventMethod, type WidgetOptions } from '@sdk/widget'

import { Timer } from './components/timer'

interface Params {
  seconds: number
  interval: number
  initialProgress: number
  initialDuration?: number
}

export class TimerWidget extends Widget<Params> {
  constructor(options: WidgetOptions<Params>) {
    super(options)
  }

  public render(): WidgetComponent {
    const { seconds, interval, initialDuration, initialProgress } = this.params
    const secondUnitContent = this.content('second_unit')
    const secondsUnitContent = this.content('seconds_unit')
    const minuteUnitContent = this.content('minute_unit')
    const minutesUnitContent = this.content('minutes_unit')
    const totalTime = initialDuration || seconds
    let totalTimeContent = ''

    if (totalTime >= 60) {
      const minutes = totalTime / 60

      totalTimeContent = this.content('total_time', {
        value: minutes % 1 === 0 ? minutes : minutes.toFixed(2),
        unit: minutes > 1 ? minutesUnitContent : minuteUnitContent
      })
    } else {
      totalTimeContent = this.content('total_time', {
        value: totalTime,
        unit: totalTime > 1 ? secondsUnitContent : secondUnitContent
      })
    }

    return new Timer({
      initialTime: seconds,
      initialProgress,
      interval,
      totalTimeContent,
      onEnd: (): WidgetEventMethod => {
        return this.sendUtterance('times_up', {
          from: 'leon'
        })
      }
    })
  }
}
