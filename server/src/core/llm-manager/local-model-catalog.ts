// Quality deductions follow the pinned llmfit quantization policy. BF16 remains
// a candidate even though llmfit's automatic quantization ladder starts at Q8.
const ORNITH_PRECISIONS = [
  { name: 'BF16', qualityPenalty: 0 },
  { name: 'Q8_0', qualityPenalty: 0 },
  { name: 'Q6_K', qualityPenalty: 1 },
  { name: 'Q5_K_M', qualityPenalty: 2 },
  { name: 'Q4_K_M', qualityPenalty: 5 }
] as const

// llmfit estimates throughput using the nearest standard quant. Native fitting
// still uses each exact published GGUF, including its mixed tensor types.
const INKLING_PRECISIONS = [
  { name: 'UD-Q8_K_XL', llmfitQuantization: 'Q8_0', qualityPenalty: 0 },
  { name: 'UD-Q4_K_XL', llmfitQuantization: 'Q4_K_M', qualityPenalty: 4 },
  { name: 'UD-Q4_K_M', llmfitQuantization: 'Q4_K_M', qualityPenalty: 5 }
] as const

export const LOCAL_LLM_PRECISIONS = [...ORNITH_PRECISIONS, ...INKLING_PRECISIONS] as const

interface LocalLLMModel {
  id: string
  name: string
  repository: string
  precisions: readonly (typeof LOCAL_LLM_PRECISIONS)[number][]
  remoteDirectory?: string
  remoteExtension?: string
  referenceQuality?: number
}

// Limit setup to single-file builds of the intended models. Mainline llama.cpp
// reads the expanded Inkling weights, which the publisher stores separately.
export const LOCAL_LLM_MODELS: readonly LocalLLMModel[] = [
  {
    id: 'ornith-ai/Ornith-1.5-9B',
    name: 'Ornith-1.5-9B',
    repository: 'ornith-ai/Ornith-1.5-9B-GGUF',
    precisions: ORNITH_PRECISIONS
  },
  {
    id: 'thinkingmachines/Inkling-2-Mini',
    name: 'Inkling-2-Mini',
    repository: 'unsloth/Inkling-2-Mini-GGUF',
    precisions: INKLING_PRECISIONS,
    remoteDirectory: 'Mainline_Support',
    remoteExtension: '.gguf_file',
    // llmfit's single-pass active-parameter heuristic undervalues this looped
    // model on Leon's agent tasks. Use a reference tier with quant penalties.
    referenceQuality: 94
  }
]
