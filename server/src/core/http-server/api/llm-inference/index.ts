import type { FastifyPluginAsync } from 'fastify'

import { postLLMInference } from '@/core/http-server/api/llm-inference/post'
import type { APIOptions } from '@/core/http-server/http-server'

export const llmInferencePlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  // LLM inference endpoint
  await fastify.register(postLLMInference, options)
}
