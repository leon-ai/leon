import { expect, it } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { getPublicModel, isPublicModelLabel } from '@/core/telemetry/report-contract'

it('reports public local model names and quantization without sending GGUF filenames or directories', () => {
  const provider = LLMProviders.LlamaCPP
  const model = 'Inkling-2-Mini'
  const checksum = 'a'.repeat(64)

  expect(getPublicModel(provider, '/home/owner/models/Inkling-2-Mini-UD-Q4_K_XL.gguf')).toEqual({
    provider, model, quantization: 'UD-Q4_K_XL'
  })
  expect(getPublicModel(provider, `C:\\Users\\owner\\models\\Inkling-2-Mini-UD-Q8_K_XL-${checksum}.gguf`)).toEqual({
    provider, model, quantization: 'UD-Q8_K_XL'
  })
  expect(getPublicModel(LLMProviders.SGLang, 'thinkingmachines/Inkling-2-Mini')).toEqual({
    provider: LLMProviders.SGLang, model
  })
  expect(isPublicModelLabel({ provider, model, quantization: 'UD-Q8_K_XL' })).toBe(true)
  expect(isPublicModelLabel({ provider, model, quantization: 'BF16' })).toBe(false)
  expect(isPublicModelLabel({ provider, model: 'Inkling-2-Mini-UD-Q4_K_XL.gguf' })).toBe(false)
})

it('keeps private files and aliases out of model labels', () => {
  const provider = LLMProviders.LlamaCPP
  const other = { provider, model: 'other' }

  expect(getPublicModel(provider, 'C:\\Users\\owner\\My Private Model-Q4_K_M.gguf')).toEqual(other)
  expect(getPublicModel(provider, 'Inkling-2-Mini-UD-Q4_K_XL-owner.gguf')).toEqual(other)
  expect(getPublicModel(provider, 'Inkling-2-Mini-UD-Q4_K_XL.gguf.bak')).toEqual(other)
  expect(isPublicModelLabel({ provider, model: 'other', quantization: 'Q4_K_M' })).toBe(false)
  expect(isPublicModelLabel({ provider: LLMProviders.SGLang, model: 'Inkling-2-Mini', quantization: 'UD-Q4_K_XL' })).toBe(false)
})
