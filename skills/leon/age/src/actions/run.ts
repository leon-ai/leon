import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'
import { Button } from '@sdk/aurora/button'

export const run: ActionFunction = async function () {
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
    key: 'answer',
    data: {
      answer: options.someSampleConfig + someSampleConfig
    }
  })

  const network = new Network({
    baseURL: 'https://jsonplaceholder.typicode.com'
  })
  const data = await network.get<{ title: string }>('/todos/1')
  await leon.answer({
    key: 'answer',
    data: {
      answer: `Todo n°1: ${data.title}`
    }
  })
}
