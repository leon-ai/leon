import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import type { ReactLLMDutyParams } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-types'
import { getTurnTimingContext, runTurnPhase, TurnPhase } from '@/core/llm-manager/turn-timing'

/**
 * Prepares the existing agent without moving execution-time inferences out of its loop.
 */
export async function prepareAgentTurn(params: ReactLLMDutyParams): Promise<ReActLLMDuty> {
  const duty = runTurnPhase(TurnPhase.Construction, () => new ReActLLMDuty({
    ...params,
    responseId: params.responseId ?? getTurnTimingContext()?.turnId ?? randomUUID()
  }))
  await runTurnPhase(TurnPhase.Duty, () => duty.init())

  return duty
}
import { randomUUID } from 'node:crypto'

