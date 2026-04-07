import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  LEON_VERSION,
  HAS_AFTER_SPEECH,
  HAS_STT,
  HAS_TTS,
  STT_PROVIDER,
  TTS_PROVIDER,
  IS_TELEMETRY_ENABLED,
  SHOULD_START_PYTHON_TCP_SERVER
} from '@/constants'
import { PERSONA } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { DateHelper } from '@/helpers/date-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getActiveLLMTarget,
  getRoutingModeLLMDisplay
} from '@/core/llm-manager/llm-routing'

export const getInfo: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route({
    method: 'GET',
    url: `/api/${options.apiVersion}/info`,
    handler: async (_request, reply) => {
      LogHelper.title('GET /info')
      const message = 'Information pulled.'
      LogHelper.success(message)

      const [
        gpuDeviceNames,
        graphicsComputeAPI,
        totalVRAM,
        freeVRAM,
        usedVRAM
      ] = await Promise.all([
        SystemHelper.getGPUDeviceNames(),
        SystemHelper.getGraphicsComputeAPI(),
        SystemHelper.getTotalVRAM(),
        SystemHelper.getFreeVRAM(),
        SystemHelper.getUsedVRAM()
      ])
      const moodState = CONFIG_STATE.getMoodState()
      const modelState = CONFIG_STATE.getModelState()
      const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
      const workflowTarget = modelState.getWorkflowTarget()
      const agentTarget = modelState.getAgentTarget()
      const activeLLMTarget = getActiveLLMTarget(
        routingMode,
        workflowTarget,
        agentTarget
      )
      const llmDisplay = getRoutingModeLLMDisplay(
        routingMode,
        workflowTarget,
        agentTarget
      )

      reply.send({
        success: true,
        status: 200,
        code: 'info_pulled',
        message,
        after_speech: HAS_AFTER_SPEECH,
        telemetry: IS_TELEMETRY_ENABLED,
        timeZone: DateHelper.getTimeZone(),
        gpu: gpuDeviceNames[0],
        graphicsComputeAPI,
        totalVRAM,
        freeVRAM,
        usedVRAM,
        llm: {
          enabled: workflowTarget.isEnabled || agentTarget.isEnabled,
          heading: llmDisplay.heading,
          display: llmDisplay.value,
          provider: activeLLMTarget.provider,
          model: activeLLMTarget.model,
          workflow: workflowTarget.label,
          agent: agentTarget.label,
          workflowEnabled: workflowTarget.isEnabled,
          agentEnabled: agentTarget.isEnabled,
          workflowProvider: workflowTarget.provider,
          agentProvider: agentTarget.provider,
          workflowModel: modelState.getWorkflowModelName(),
          agentModel: modelState.getAgentModelName(),
          localModel: modelState.getLocalModelName()
        },
        stt: {
          enabled: HAS_STT,
          provider: STT_PROVIDER
        },
        tts: {
          enabled: HAS_TTS,
          provider: TTS_PROVIDER
        },
        routingMode,
        tcpServer: {
          enabled: SHOULD_START_PYTHON_TCP_SERVER
        },
        mood: {
          type: PERSONA.mood.type,
          emoji: PERSONA.mood.emoji,
          mode: moodState.getConfiguredMood()
        },
        version: LEON_VERSION
      })
    }
  })
}
