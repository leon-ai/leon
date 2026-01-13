import { ActionRecognitionLLMDuty } from '@/core/llm-manager/llm-duties/action-recognition-llm-duty'
// import { ConversationLLMDuty } from '@/core/llm-manager/llm-duties/conversation-llm-duty'
import { CustomNERLLMDuty } from '@/core/llm-manager/llm-duties/custom-ner-llm-duty'
import { ParaphraseLLMDuty } from '@/core/llm-manager/llm-duties/paraphrase-llm-duty'
import { SkillRouterLLMDuty } from '@/core/llm-manager/llm-duties/skill-router-llm-duty'
import { ActionCallingLLMDuty } from '@/core/llm-manager/llm-duties/action-calling-llm-duty'
import { SlotFillingLLMDuty } from '@/core/llm-manager/llm-duties/slot-filling-llm-duty'
import { LLMDuties } from '@/core/llm-manager/types'

export default async (llmDutiesToWarmUp: LLMDuties[]): Promise<void> => {
  /**
   * Conversation LLM Duty warm-up
   */
  /*const conversationDuty = new ConversationLLMDuty()
  await conversationDuty.init()
  await conversationDuty.execute({
    isWarmingUp: true
  })*/

  /**
   * Skill router LLM Duty warm-up
   */
  const skillRouterDuty = new SkillRouterLLMDuty({
    input: 'I cannot think of a number now, please help'
  })
  await skillRouterDuty.init()
  await skillRouterDuty.execute()

  /**
   * Action calling LLM Duty warm-up
   */
  const actionCallingDuty = new ActionCallingLLMDuty({
    input: 'Hello there!',
    skillName: 'greeting_skill'
  })
  await actionCallingDuty.init()
  await actionCallingDuty.execute()

  /**
   * Slot filling LLM Duty warm-up
   */
  const slotFillingDuty = new SlotFillingLLMDuty({
    input: {
      slotName: 'location',
      slotDescription: 'A place where the user wants to go',
      slotType: 'string'
    },
    startingUtterance: 'I want to go somewhere'
  })
  await slotFillingDuty.init()
  await slotFillingDuty.execute({
    isWarmingUp: true
  })

  /**
   * Custom NER LLM Duty warm-up
   */
  const customNERDuty = new CustomNERLLMDuty({
    input:
      'Add apples, 1L of milk, orange juice and tissues to the shopping list',
    data: {
      schema: {
        items: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        list_name: {
          type: 'string'
        }
      }
    }
  })
  await customNERDuty.init()
  await customNERDuty.execute()

  if (llmDutiesToWarmUp.includes(LLMDuties.ActionRecognition)) {
    /**
     * Action Recognition LLM Duty warm-up
     */
    const actionRecognitionDuty = new ActionRecognitionLLMDuty({
      input: 'Hi there',
      data: {
        existingContextName: null
      }
    })
    await actionRecognitionDuty.init()
    await actionRecognitionDuty.execute()
  }

  if (llmDutiesToWarmUp.includes(LLMDuties.Paraphrase)) {
    /**
     * Paraphrase LLM Duty warm-up
     */
    const paraphraseDuty = new ParaphraseLLMDuty({
      input: 'We have a wonderful planet.'
    })
    await paraphraseDuty.init()
    await paraphraseDuty.execute({
      isWarmingUp: true
    })
  }
}
