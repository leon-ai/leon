import { leon } from '@sdk/leon'
import { TextAnswer } from '@sdk/answer'
import { Button } from '@sdk/aurora/button'

export async function run(): Promise<void> {
  await leon.answer(new TextAnswer('intermediate answer'))

  console.log('button', Button)

  await leon.answer(new TextAnswer('final answer'))
}
