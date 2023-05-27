import utility from 'utility' // TODO

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'
import { Button } from '@sdk/aurora/button'
import { Memory } from '@sdk/memory'
import { Settings } from '@sdk/settings'
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
  await leon.answer({ key: 'test' })

  ///

  const button = new Button({
    text: 'Hello world from action skill'
  })
  await leon.answer({ widget: button })

  ///

  const otherSkillMemory = new Memory({
    name: 'productivity:todo_list:db'
  })
  try {
    const todoLists = await otherSkillMemory.read()
    console.log('todoLists', todoLists)
  } catch {
    console.log('todoLists', [])
  }

  const postsMemory = new Memory<Post[]>({ name: 'posts', defaultMemory: [] })
  await postsMemory.write([
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
  let posts = await postsMemory.read()
  console.log('posts', posts)

  posts = await postsMemory.write([
    ...posts,
    {
      id: 2,
      title: 'Hello world 3',
      content: 'This is a test post 3',
      author: {
        name: 'Louis'
      }
    }
  ])

  const foundPost = posts.find((post) => post.id === 2)

  console.log('foundPost', foundPost)

  console.log('keyBy', _.keyBy(posts, 'id'))

  ///

  await leon.answer({ key: 'default' })

  await leon.answer({ key: utility.md5('test') })

  await leon.answer({
    key: 'greet',
    data: {
      name: 'Louis'
    }
  })

  const settings = new Settings()

  if (!(await settings.isAlreadySet('apiKey'))) {
    await leon.answer({
      key: 'answer',
      data: {
        answer: "The API key isn't set..."
      }
    })
  }

  const currentSettings = await settings.get()

  await settings.set({
    ...currentSettings,
    apiKey: 'newAPIKey'
  })

  await leon.answer({
    key: `Is API set now? ${await settings.isAlreadySet('apiKey')}`
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
