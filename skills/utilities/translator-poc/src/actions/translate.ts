import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'

export const run: ActionFunction = async function () {
  const network = new Network({
    baseURL: `${process.env['LEON_HOST']}:${process.env['LEON_PORT']}/api/v1`
  })

  /**
   * TODO: create SDK methods to handle request and response for every LLM duty
   */
  const response = await network.request({
    url: '/llm-inference',
    method: 'POST',
    data: {
      dutyType: 'translation',
      // TODO: get text entity to translate
      input: 'Bonjour tout le monde !',
      data: {
        target: 'English',
        autoDetectLanguage: true
      }
    }
  })

  await leon.answer({
    key: 'translate',
    data: {
      output: response.data.output.o
    }
  })
}
