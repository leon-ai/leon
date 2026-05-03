import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function () {
  const currentDate = new Date()
  await leon.answer({
    key: 'current_time',
    data: {
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds())
    }
  })
}
