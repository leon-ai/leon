import * as utility from 'utility'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'
import { Memory } from '@sdk/memory'
import { Button } from '@sdk/aurora/button'

export const run: ActionFunction = async function () {
  const db = new Memory()

  await db.test()

  await leon.answer({ key: 'default' })

  await leon.answer({ key: utility.md5('test') })

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

  try {
    const response = await network.request<{ title: string }>({
      url: '/todos/1',
      method: 'GET'
    })
    await leon.answer({
      key: 'answer',
      data: {
        answer: `Todo: ${response.data.title}`
      }
    })
  } catch (error) {
    await leon.answer({
      key: 'answer',
      data: {
        answer: 'Something went wrong...'
      }
    })
    if (network.isNetworkError(error)) {
      const errorData = JSON.stringify(error.response.data, null, 2)
      await leon.answer({
        key: 'answer',
        data: {
          answer: `${error.message}: ${errorData}`
        }
      })
    }
  }
}
