import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { deleteAllTimersMemory } from '../lib/memory'

export const run: ActionFunction = async function () {
  await deleteAllTimersMemory()

  await leon.answer({ key: 'timer_canceled' })
}
