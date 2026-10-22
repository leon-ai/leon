import fs from 'node:fs'
import path from 'node:path'

import {
  BIN_PATH,
  LEON_TOOLKITS_PATH,
  LEON_VERSION,
  NODEJS_BRIDGE_VERSION,
  PYTHON_BRIDGE_VERSION,
  PYTHON_TCP_SERVER_VERSION,
  TOOLS_PATH
} from '@/constants'
import { resolveToolBinaryPath } from '@@/bridges/runtime/nodejs/tool-binary'
import { DateHelper } from '@/helpers/date-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { ToolManifestSchema } from '@/schemas/tool-schemas'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  getActiveLLMTarget,
  getRoutingModeLLMDisplay
} from '@/core/llm-manager/llm-routing'

export interface LeonRuntimeContextResolvers {
  getWorkflowLLMName: () => string
  getAgentLLMName: () => string
  getLocalLLMName: () => string
  runtime?: { nodeVersion: string, executable: string, pid: number }
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
    const runtime = this.resolvers.runtime || {
      nodeVersion: process.version, executable: process.execPath, pid: process.pid
    }
    const toolBinaries = this.getToolBinaryInventory()
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
      `> Runtime versions, routing/providers, LLMs and bridge/toolchain availability. My version is ${LEON_VERSION || 'unknown'}; I run on Node ${runtime.nodeVersion}; routing mode ${routingMode}; ${llmDisplay.heading.toLowerCase()} ${llmDisplay.value}; local LLM ${localLlmName}; managed node ${nodeBinPath} ${this.probeHelper.formatCommandProbe(nodeProbe)}, managed python ${pythonBinPath} ${this.probeHelper.formatCommandProbe(pythonProbe)}, managed pnpm ${this.probeHelper.formatCommandProbe(pnpmProbe)}, git ${this.probeHelper.formatCommandProbe(gitProbe)}.`,
      '# LEON_RUNTIME',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Leon version: ${LEON_VERSION || 'unknown'}`,
      `- Running server Node.js version: ${runtime.nodeVersion}`,
      `- Running server executable: ${runtime.executable}`,
      `- Running server PID: ${runtime.pid}`,
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
      '- In shell tools, invoke node directly (for example: node --version). I supply the managed runtime to the tool environment.',
      '- Use the resolved executable paths below verbatim if an absolute path is needed; do not derive binary paths from the codebase directory.',
      `- Bin path: ${BIN_PATH}`,
      `- Node.js: ${nodeBinPath} (${this.probeHelper.formatCommandProbe(nodeProbe)})`,
      `- pnpm: ${pnpmBinPath} (${this.probeHelper.formatCommandProbe(pnpmProbe)})`,
      `- Python: ${pythonBinPath} (${this.probeHelper.formatCommandProbe(pythonProbe)})`,
      `- uv: ${uvBinPath} (${this.probeHelper.formatCommandProbe(uvProbe)})`,
      `- git: ${this.probeHelper.formatCommandProbe(gitProbe)}`,
      `- Node.js bridge version: ${NODEJS_BRIDGE_VERSION}`,
      `- Python bridge version: ${PYTHON_BRIDGE_VERSION}`,
      `- Python TCP server version: ${PYTHON_TCP_SERVER_VERSION}`,
      '## Host Tool Executables',
      '- Host installations; tool availability and Satellite installations are tracked separately.',
      ...toolBinaries
    ].join('\n')
  }

  /**
   * Inspects declared host executables without importing or preparing tool runtimes.
   */
  private getToolBinaryInventory(): string[] {
    const platform = SystemHelper.getBinariesFolderName()
    const entries = new Map<string, string>()
    const roots = [TOOLS_PATH, getProfilePaths().tools]

    for (const root of roots) {
      for (const relativePath of fs.globSync('*/*/tool.json', { cwd: root })) {
        const manifestPath = path.join(root, relativePath)
        const toolId = path.basename(path.dirname(relativePath))
        const toolkitId = path.basename(path.dirname(path.dirname(relativePath)))
        const qualifiedId = `${toolkitId}.${toolId}`

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ToolManifestSchema
          const source = manifest.binaries?.[platform]
          // A profile manifest replaces the built-in declaration even when
          // its implementation no longer uses a downloadable executable.
          entries.delete(qualifiedId)
          if (!source) {
            continue
          }

          const binaryPath = resolveToolBinaryPath(LEON_TOOLKITS_PATH, toolkitId, source)
          const installed = fs.existsSync(binaryPath)

          entries.set(
            qualifiedId,
            `- ${qualifiedId}: ${installed ? 'installed' : 'not installed'}; ${binaryPath}`
          )
        } catch {
          entries.set(qualifiedId, `- ${qualifiedId}: executable inventory unavailable; inspect manifest: ${manifestPath}`)
        }
      }
    }

    return [...entries].sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry)
  }
}
