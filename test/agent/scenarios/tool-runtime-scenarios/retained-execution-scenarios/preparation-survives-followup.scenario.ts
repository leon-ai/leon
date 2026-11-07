import { exerciseToolPreparation } from '../../../../core/fixtures/tool-preparation'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const resource = await exerciseToolPreparation('resource')
    const binary = await exerciseToolPreparation('binary')
    const parallel = await exerciseToolPreparation('parallel')
    const stopped = await exerciseToolPreparation('stop')
    const interruptedAction = await exerciseToolPreparation('action')

    return { resource, binary, parallel, stopped, interruptedAction }
  }
}

export default scenario
