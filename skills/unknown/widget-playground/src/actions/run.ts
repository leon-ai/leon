import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

export const run: ActionFunction = async function () {
  /**
   * Random number
   */

  const text = new Text({
    text: '42',
    size: 'xxl'
  })

  await leon.answer({ widget: text })
}
