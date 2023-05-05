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

  const { someSampleConfig } = leon.getSRCConfig<{
    options: { someSampleConfig: string }
  }>()['options']

  const options = leon.getSRCConfig<{ someSampleConfig: string }>('options')
  await leon.answer({
    key: 'config',
    data: {
      config: options.someSampleConfig + someSampleConfig
    }
  })
}
