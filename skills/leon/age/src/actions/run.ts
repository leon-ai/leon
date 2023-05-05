import { leon } from '@sdk/leon'
import { Button } from '@sdk/aurora/button'

export async function run(): Promise<void> {
  await leon.answer({ key: 'default' })

  await leon.answer({
    key: 'greet',
    data: {
      name: 'Louis'
    }
  })

  console.log('button', Button)
}
