import type { NLPSkill } from '@/core/nlp/types'
import type Brain from '@/core/brain/brain'
import type NaturalLanguageUnderstanding from '@/core/nlp/nlu/nlu'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { Telemetry } from '@/telemetry'
import { RoutingMode } from '@/types'

const OWNER_MESSAGE_ID_RANDOM_LENGTH = 6

interface OwnerMessageIngressInput {
  utterance: string
  ownerMessageId?: string
  forcedRoutingMode?: RoutingMode
  forcedSkillName?: NLPSkill
}

interface OwnerMessageIngressResult {
  ownerMessageId: string
}

interface OwnerMessageIngressDependencies {
  brain: Brain
  nlu: NaturalLanguageUnderstanding
}

export class OwnerMessageIngress {
  public constructor(
    private readonly dependencies: OwnerMessageIngressDependencies
  ) {}

  /**
   * Handle an owner message before it enters the NLU pipeline.
   */
  public async handle(
    input: OwnerMessageIngressInput
  ): Promise<OwnerMessageIngressResult> {
    const utterance = input.utterance.trim()
    if (!utterance) {
      throw new Error('Owner message utterance cannot be empty')
    }

    const ownerMessageId =
      input.ownerMessageId ||
      `owner-${Date.now()}-${StringHelper.random(OWNER_MESSAGE_ID_RANDOM_LENGTH)}`

    // Always interrupt Leon's voice when the owner sends a new message.
    this.dependencies.brain.setIsTalkingWithVoice(false, { shouldInterrupt: true })
    this.dependencies.brain.isMuted = false

    try {
      const processedData = await this.dependencies.nlu.process(utterance, {
        ownerMessageId,
        ...(input.forcedRoutingMode
          ? { forcedRoutingMode: input.forcedRoutingMode }
          : {}),
        ...(input.forcedSkillName
          ? { forcedSkillName: input.forcedSkillName }
          : {})
      })

      if (processedData) {
        void Telemetry.utterance(processedData)
      }
    } catch (error) {
      LogHelper.title('Owner Message Ingress')
      LogHelper.error(`Failed to process owner message: ${String(error)}`)
      throw error
    }

    return {
      ownerMessageId
    }
  }
}
