import { LLMDuties } from '@/core/llm-tcp-server/types'

export class LLMDuty {
  constructor(type: LLMDuties) {
    console.log('type', type)
  }
}
