import utility from 'utility'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'
import { Button } from '@sdk/aurora/button'
import { Memory } from '@sdk/memory'
import _ from '@sdk/packages/lodash'

interface Post {
  id: number
  title: string
  content: string
  author: {
    name: string
  }
}

export const run: ActionFunction = async function () {
  const postsMemory = new Memory('posts')
  const websiteLayoutMemory = new Memory('websiteLayout')

  await postsMemory.delete('1')

  await websiteLayoutMemory.set('webSiteLayout', [
    {
      name: 'header',
      component: '<Header>'
    },
    {
      name: 'footer',
      component: '<Footer>'
    }
  ])

  await postsMemory.set('posts', [
    {
      id: 0,
      title: 'Hello world',
      content: 'This is a test post',
      author: {
        name: 'Louis'
      }
    },
    {
      id: 1,
      title: 'Hello world 2',
      content: 'This is a test post 2',
      author: {
        name: 'Louis'
      }
    }
  ])

  await postsMemory.set('metaData', {
    size: 50484,
    type: 'image/png'
  })

  const metaData = await postsMemory.get<{ size: number; type: string }>(
    'metaData'
  )
  const posts = await postsMemory.get<Post[]>('posts')
  const websiteLayout = await websiteLayoutMemory.get<{
    webSiteLayout: { name: string; component: string }[]
  }>('webSiteLayout')

  console.log('posts', posts)
  console.log('metaData', metaData)
  console.log('websiteLayout', websiteLayout)

  await postsMemory.set('posts', [
    ...posts,
    {
      id: 2,
      title: 'Hello world 3',
      content: 'This is a test post 3'
    }
  ])

  const posts2 = await postsMemory.get<Post[]>('posts')

  const foundPost = posts2.find((post) => post.id === 2)

  console.log('foundPost', foundPost)

  console.log('keyBy', _.keyBy(posts2, 'id'))

  ///

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
