// These sources preserve the publishers' trained models. Each entry declares
// exact single-file builds so a projector or draft cannot be selected as a model.
export const LOCAL_LLM_MODELS = [
  {
    id: 'ornith-ai/Ornith-1.5-9B',
    name: 'Ornith-1.5-9B',
    repository: 'ornith-ai/Ornith-1.5-9B-GGUF',
    filePrefix: 'Ornith-1.5-9B'
  },
  {
    id: 'Qwen/Qwen3.8-27B',
    name: 'Qwen3.8-27B',
    repository: 'bartowski/Qwen3.8-27B-GGUF',
    filePrefix: 'Qwen3.8-27B',
    fullPrecisionRepository: 'ggml-org/Qwen3.8-27B-GGUF'
  }
]

// Quality deductions follow the pinned llmfit quantization policy. BF16 remains
// a candidate even though llmfit's automatic quantization ladder starts at Q8.
export const LOCAL_LLM_PRECISIONS = [
  { name: 'BF16', qualityPenalty: 0 },
  { name: 'Q8_0', qualityPenalty: 0 },
  { name: 'Q6_K', qualityPenalty: 1 },
  { name: 'Q5_K_M', qualityPenalty: 2 },
  { name: 'Q4_K_M', qualityPenalty: 5 }
]
