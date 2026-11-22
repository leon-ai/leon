import { expect, it } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { getPublicModel, isPublicModelLabel } from '@/core/telemetry/report-contract'

it('reports public local model names and quantization without sending GGUF filenames or directories', () => {
  const provider = LLMProviders.LlamaCPP
  const model = 'Qwen3.8-27B'
  const checksum = 'a'.repeat(64)

  expect(getPublicModel(provider, '/home/owner/models/Qwen3.8-27B-Q4_K_M.gguf')).toEqual({
    provider, model, quantization: 'Q4_K_M'
  })
  expect(getPublicModel(provider, `C:\\Users\\owner\\models\\Qwen3.8-27B-BF16-${checksum}.gguf`)).toEqual({
    provider, model, quantization: 'BF16'
  })
  expect(getPublicModel(LLMProviders.SGLang, 'Qwen/Qwen3.8-27B')).toEqual({
    provider: LLMProviders.SGLang, model
  })
  expect(isPublicModelLabel({ provider, model, quantization: 'BF16' })).toBe(true)
  expect(isPublicModelLabel({ provider, model: 'Qwen3.8-27B-Q4_K_M.gguf' })).toBe(false)
})

it('keeps private files and aliases out of model labels', () => {
  const provider = LLMProviders.LlamaCPP
  const other = { provider, model: 'other' }

  expect(getPublicModel(provider, 'C:\\Users\\owner\\My Private Model-Q4_K_M.gguf')).toEqual(other)
  expect(getPublicModel(provider, 'Qwen3.8-27B-Q4_K_M-owner.gguf')).toEqual(other)
  expect(getPublicModel(provider, 'Qwen3.8-27B-Q4_K_M.gguf.bak')).toEqual(other)
  expect(isPublicModelLabel({ provider, model: 'other', quantization: 'Q4_K_M' })).toBe(false)
  expect(isPublicModelLabel({ provider: LLMProviders.SGLang, model: 'Qwen3.8-27B', quantization: 'Q4_K_M' })).toBe(false)
})
