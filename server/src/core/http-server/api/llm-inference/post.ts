import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { LLMDuties } from '@/core/llm-manager/types'
import { CustomNERLLMDuty } from '@/core/llm-manager/llm-duties/custom-ner-llm-duty'
import { SummarizationLLMDuty } from '@/core/llm-manager/llm-duties/summarization-llm-duty'
import { TranslationLLMDuty } from '@/core/llm-manager/llm-duties/translation-llm-duty'
import { LLM_MANAGER } from '@/core'

interface PostLLMInferenceSchema {
  body: {
    dutyType: LLMDuties
    systemPrompt: string
    input: string
    data: Record<string, unknown>
  }
}

const LLM_DUTIES_MAP = {
  [LLMDuties.CustomNER]: CustomNERLLMDuty,
  [LLMDuties.Summarization]: SummarizationLLMDuty,
  [LLMDuties.Translation]: TranslationLLMDuty
}

export const postLLMInference: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Body: PostLLMInferenceSchema['body']
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/llm-inference`,
    handler: async (request, reply) => {
      const params = request.body

      try {
        if (!LLM_MANAGER.isLLMEnabled) {
          reply.statusCode = 400
          reply.send({
            message: 'LLM is not enabled.',
            success: false
          })

          return
        }

        if (!LLM_DUTIES_MAP[params.dutyType]) {
          reply.statusCode = 400
          reply.send({
            message: `LLM duty type "${params.dutyType}" not supported.`,
            success: false
          })

          return
        }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const duty = new LLM_DUTIES_MAP[params.dutyType](params)
        const llmResult = await duty.execute()

        reply.send({
          success: true,
          status: 200,
          code: 'llm_duty_executed',
          message: 'LLM duty executed.',
          ...llmResult
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : error
        reply.statusCode = 500
        reply.send({
          message,
          success: false
        })
      }
    }
  })
}
