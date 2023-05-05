import { leon } from '@sdk/leon'
import type { ActionFunction } from '@sdk/leon'
import { Button } from '@sdk/aurora/button'

export const run: ActionFunction = async () => {
  await leon.answer({ key: 'default' })

  await leon.answer({
    key: 'greet',
    data: {
      name: 'Louis'
    }
  })

  console.log('button', Button)
}
