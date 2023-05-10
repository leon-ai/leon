import utility from 'utility'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'
import { Database } from '@sdk/memory'
import { Button } from '@sdk/aurora/button'

export const run: ActionFunction = async function () {
  const blog = new Database('blog')
  // const testo = new Database('leon.greets.testo') // From other skill

  const posts = await blog.get('posts')
  const sections = await blog.get('sections')

  posts.push(
    {
      id: 0,
      title: 'hello world',
      content: 'hello world',
      author: {
        name: 'Louis'
      },
      createdAt: Date.now()
    },
    {
      id: 1,
      title: 'hello world 2',
      content: 'hello world 2',
      author: {
        name: 'Louis'
      },
      createdAt: Date.now()
    },
    {
      id: 2,
      title: 'hello world 3',
      content: 'hello world 3',
      author: {
        name: 'Line'
      },
      createdAt: Date.now()
    }
  )

  sections.push({
    type: 'header',
    width: '100%',
    height: '100px'
  })

  // await blog.posts.getAll()
  // await posts.find()

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
