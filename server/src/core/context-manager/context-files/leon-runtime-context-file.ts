import {
  BIN_PATH,
  LEON_VERSION,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_VERSION,
  PYTHON_TCP_SERVER_VERSION
} from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getActiveLLMTarget,
  getRoutingModeLLMDisplay
} from '@/core/llm-manager/llm-routing'

interface LeonRuntimeContextResolvers {
  getWorkflowLLMName: () => string
  getAgentLLMName: () => string
  getLocalLLMName: () => string
}

export class LeonRuntimeContextFile extends ContextFile {
  public readonly filename = 'LEON_RUNTIME.md'
  public readonly ttlMs: number

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    private readonly resolvers: LeonRuntimeContextResolvers,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const nodeProbe = this.probeHelper.probeCommandVersion(
      RuntimeHelper.getNodeBinPath(),
      ['--version']
    )
    const pnpmProbe = this.probeHelper.probeCommandVersion(
      RuntimeHelper.getPNPMBinPath(),
      ['--version']
    )
    const pythonProbe = this.probeHelper.probeCommandVersion(
      RuntimeHelper.getPythonBinPath(),
      ['--version']
    )
    const uvProbe = this.probeHelper.probeCommandVersion(
      RuntimeHelper.getUVBinPath(),
      ['--version']
    )
    const gitProbe = this.probeHelper.probeCommandVersion('git', ['--version'])
    const nodeBinPath = RuntimeHelper.getNodeBinPath()
    const pnpmBinPath = RuntimeHelper.getPNPMBinPath()
    const pythonBinPath = RuntimeHelper.getPythonBinPath()
    const uvBinPath = RuntimeHelper.getUVBinPath()
    const workflowLlmName = this.resolvers.getWorkflowLLMName()
    const agentLlmName = this.resolvers.getAgentLLMName()
    const localLlmName = this.resolvers.getLocalLLMName()
    const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
    const modelState = CONFIG_STATE.getModelState()
    const llmDisplay = getRoutingModeLLMDisplay(
      routingMode,
      modelState.getWorkflowTarget(),
      modelState.getAgentTarget()
    )
    const activeLLMTarget = getActiveLLMTarget(
      routingMode,
      modelState.getWorkflowTarget(),
      modelState.getAgentTarget()
    )

    return [
      `> Runtime versions, routing/providers, LLMs and bridge/toolchain availability. I am running Leon ${LEON_VERSION || 'unknown'} on Node ${process.version}; routing mode ${routingMode}; ${llmDisplay.heading.toLowerCase()} ${llmDisplay.value}; local LLM ${localLlmName}; managed node ${nodeBinPath} ${this.probeHelper.formatCommandProbe(nodeProbe)}, managed python ${pythonBinPath} ${this.probeHelper.formatCommandProbe(pythonProbe)}, managed pnpm ${this.probeHelper.formatCommandProbe(pnpmProbe)}, git ${this.probeHelper.formatCommandProbe(gitProbe)}.`,
      '# LEON_RUNTIME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Leon version: ${LEON_VERSION || 'unknown'}`,
      `- Node.js version: ${process.version}`,
      `- Routing mode: ${routingMode}`,
      `- ${llmDisplay.heading}: ${llmDisplay.value}`,
      `- Active LLM provider: ${activeLLMTarget.provider}`,
      ...(routingMode === 'smart'
        ? [
            `- Workflow LLM provider: ${modelState.getWorkflowProvider()}`,
            `- Agent LLM provider: ${modelState.getAgentProvider()}`,
            `- Workflow LLM: ${workflowLlmName}`,
            `- Agent LLM: ${agentLlmName}`
          ]
        : []),
      `- Local LLM: ${localLlmName}`,
      '## Managed Binaries',
      `- Bin path: ${BIN_PATH}`,
      `- Node.js: ${nodeBinPath} (${this.probeHelper.formatCommandProbe(nodeProbe)})`,
      `- pnpm: ${pnpmBinPath} (${this.probeHelper.formatCommandProbe(pnpmProbe)})`,
      `- Python: ${pythonBinPath} (${this.probeHelper.formatCommandProbe(pythonProbe)})`,
      `- uv: ${uvBinPath} (${this.probeHelper.formatCommandProbe(uvProbe)})`,
      `- git: ${this.probeHelper.formatCommandProbe(gitProbe)}`,
      `- Node.js bridge version: ${NODEJS_BRIDGE_VERSION}`,
      `- Python bridge version: ${PYTHON_BRIDGE_VERSION}`,
      `- Python TCP server version: ${PYTHON_TCP_SERVER_VERSION}`
    ].join('\n')
  }
}
