import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

export const run: ActionFunction = async function (params) {
  const currentDate = new Date()
  await leon.answer({
    key: 'current_date',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear()
    }
  })
}
