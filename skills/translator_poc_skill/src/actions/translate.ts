import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { Network } from '@sdk/network'

export const run: ActionFunction = async function (_params, paramsHelper) {
  // const targetLanguage = paramsHelper.findActionArgumentFromContext('target_language')
  const targetLanguage = paramsHelper.getActionArgument('target_language')
  // const textToTranslate = paramsHelper.findActionArgumentFromContext('text_to_translate')
  const textToTranslate = paramsHelper.getActionArgument('text_to_translate')
  const network = new Network({
    baseURL: `${process.env['LEON_HOST']}:${process.env['LEON_PORT']}/api/v1`
  })
  const systemPrompt = `You are an AI system that translates a given text to "${targetLanguage}" by auto-detecting the source language. You do not add any context to your response.`
  const prompt = `Text to translate: "${textToTranslate}"`

  /**
   * TODO: create SDK methods to handle request and response for every LLM duty
   */
  const response = await network.request({
    url: '/llm-inference',
    method: 'POST',
    data: {
      dutyType: 'custom',
      input: prompt,
      data: {
        system_prompt: systemPrompt,
        thought_tokens_budget: 0,
        temperature: 0.2
      }
    }
  })
  const translation = response.data.output

  await leon.answer({
    key: 'translation',
    data: {
      output: translation
    }
  })
}
