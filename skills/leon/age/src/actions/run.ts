import type { ActionResponse } from '@sdk/types'
import { IntermediateAnswer, FinalAnswer } from '@sdk/answer'

export async function run(): Promise<ActionResponse> {
  await new IntermediateAnswer().text('intermediate answer')

  return await new FinalAnswer().text('final answer')
}
