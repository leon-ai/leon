import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  context: '', disabled: [] as string[],
  bindings: {} as Record<string, string>,
  snapshot: null as { files: Record<string, string> } | null,
  generate: vi.fn(() => '> Local app inventory')
}))
vi.mock('@/core', () => ({
  TOOLKIT_REGISTRY: {}, LLM_PROVIDER: {}
}))
vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: vi.fn(() => ({
  context: { disabled_files: state.disabled }, satellite: { tools: state.bindings }
})) } }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: vi.fn(() => ({
    name: 'owner-a', context: state.context,
    tools: path.join(state.context, 'profile-tools')
  }))
}))
vi.mock('@/constants', () => ({
  CODEBASE_CONTEXT_PATH: '', CODEBASE_PATH: '', NODE_RUNTIME_BIN_PATH: '', TSX_CLI_PATH: '',
  BIN_PATH: '/managed', LEON_VERSION: 'fixture', NODEJS_BRIDGE_VERSION: 'fixture',
  PYTHON_BRIDGE_VERSION: 'fixture', PYTHON_TCP_SERVER_VERSION: 'fixture',
  get TOOLS_PATH(): string {
    return path.join(state.context, 'tools')
  },
  get LEON_TOOLKITS_PATH(): string {
    return path.join(state.context, 'toolkits')
  }
}))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {
  getRoutingModeState: vi.fn(() => ({ getRoutingMode: vi.fn(() => 'agent') })),
  getModelState: vi.fn(() => ({
    getWorkflowTarget: vi.fn(() => ({ provider: 'openai', model: 'fixture' })),
    getAgentTarget: vi.fn(() => ({ provider: 'openai', model: 'fixture' }))
  }))
} }))
vi.mock('@/core/context-manager/context-probe-helper', () => ({ ContextProbeHelper: class {} }))
vi.mock('@/helpers/log-helper', () => ({ LogHelper: { title: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/core/context-manager/context-file-factory', () => ({
  DEFAULT_CONTEXT_REFRESH_TTL_MS: 600_000,
  createContextFiles: vi.fn(() => ['ACTIVITY.md', 'LOCAL_INVENTORY.md'].map((filename) => ({
    filename, ttlMs: 600_000, generate: state.generate
  })))
}))
vi.mock('@/core/satellite/satellite-registry', () => ({
  SATELLITE_REGISTRY: { getContext: vi.fn((owner: string, device: string) =>
    owner === 'owner-a' && device === 'device-a' ? state.snapshot : null) }
}))

import ContextManager from '@/core/context-manager/context-manager'
import { LeonRuntimeContextFile } from '@/core/context-manager/context-files/leon-runtime-context-file'
import { ContextProbeHelper, type CommandProbe } from '@/core/context-manager/context-probe-helper'
import { SystemHelper } from '@/helpers/system-helper'

beforeEach(() => {
  state.context = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-discovery-'))
  state.disabled = []
  state.bindings = {}
  state.snapshot = null
})
afterEach(() => fs.rmSync(state.context, { recursive: true, force: true }))

it('replaces old server context for file tools and prompts, then fails closed when the device goes away', () => {
  state.bindings = { 'computer_use.cua': 'device-a' }
  fs.writeFileSync(path.join(state.context, 'ACTIVITY.md'), '> WRONG SERVER APPS')
  const manager = new ContextManager()
  Object.assign(manager, { _isLoaded: true })
  expect(manager.getContextFileContent('ACTIVITY.md')).toContain('unavailable')
  expect(state.generate).not.toHaveBeenCalled()
  state.snapshot = { files: { 'ACTIVITY.md': '> Owner terminal apps' } }
  expect(manager.getContextFileContent('ACTIVITY.md')).toContain('Owner terminal apps')
  expect(fs.readFileSync(path.join(state.context, 'ACTIVITY.md'), 'utf8')).not.toContain('WRONG SERVER')
  expect(manager.getManifest()).toContain('Paired device')
  state.snapshot = null
  manager.synchronizeDeviceContext()
  expect(fs.readFileSync(path.join(state.context, 'ACTIVITY.md'), 'utf8')).toContain('unavailable')
  expect(manager.getManifest()).not.toContain('Owner terminal apps')
  expect(manager.getManifest()).toContain('unavailable')
})

it('does not substitute another device, merge ambiguous bindings, or ignore disabled context', () => {
  state.snapshot = { files: { 'ACTIVITY.md': '> Owner terminal apps' } }
  state.bindings = { 'computer_use.cua': 'device-b' }
  const manager = new ContextManager()
  Object.assign(manager, { _isLoaded: true })
  expect(manager.getContextFileContent('ACTIVITY.md')).toContain('unavailable')
  state.bindings = { 'computer_use.cua': 'device-a', 'browser_use.browser-use': 'device-b' }
  expect(manager.getContextFileContent('ACTIVITY.md')).toContain('unavailable')
  state.disabled = ['*']
  const disabled = new ContextManager()
  Object.assign(disabled, { _isLoaded: true })
  expect(disabled.getContextFileContent('ACTIVITY.md')).toBeNull()
})

it('keeps local generation when no device binding exists and omits disabled device snapshot files', async () => {
  const manager = new ContextManager()
  Object.assign(manager, { _isLoaded: true })
  expect(manager.getContextFileContent('LOCAL_INVENTORY.md')).toContain('Local app inventory')
  expect(state.generate).toHaveBeenCalledOnce()
  // A fresh local file can be exported without starting another probe worker.
  expect(await manager.getDeviceDiscoverySnapshot(['LOCAL_INVENTORY.md'])).toEqual({
    files: { 'LOCAL_INVENTORY.md': '> Local app inventory\n' }
  })
  state.disabled = ['*']
  expect(await new ContextManager().getDeviceDiscoverySnapshot(['LOCAL_INVENTORY.md'])).toEqual({ files: {} })
})

it('grounds runtime context in the server process and exact host tool installations', () => {
  const toolkitPath = path.join(state.context, 'tools', 'documents')
  const manifestPath = path.join(toolkitPath, 'search', 'tool.json')
  const executable = path.join(
    state.context, 'toolkits', 'documents', 'assets',
    process.platform === 'win32' ? 'search-2.0.exe' : 'search-2.0'
  )
  const platform = SystemHelper.getBinariesFolderName()
  const manifest = {
    binaries: { [platform]: 'https://user:secret@example.com/search-2.0.tar.gz?token=private' }
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  fs.writeFileSync(executable, '')

  const probe = Object.assign(new ContextProbeHelper(), {
    probeCommandVersion: vi.fn(() => ({ available: true, version: 'installed 1.0' })),
    formatCommandProbe: (result: CommandProbe) => result.version
  })
  const definition = new LeonRuntimeContextFile(probe, {
    getWorkflowLLMName: (): string => 'fixture',
    getAgentLLMName: (): string => 'fixture',
    getLocalLLMName: (): string => 'fixture',
    runtime: { nodeVersion: 'live 0.9', executable: '/running/node', pid: 123 }
  }, 600_000)
  const content = definition.generate()

  expect(content).toContain('Running server Node.js version: live 0.9')
  expect(content).toContain('Running server executable: /running/node')
  expect(content).toContain('Running server PID: 123')
  expect(content).toContain(`documents.search: installed; ${executable}`)
  expect(content).not.toContain('secret')
  expect(content).not.toContain('token=private')

  fs.unlinkSync(executable)

  expect(definition.generate()).toContain('documents.search: not installed;')
  expect(probe.probeCommandVersion).not.toHaveBeenCalledWith(executable, ['--version'])

  const profileManifest = path.join(state.context, 'profile-tools', 'documents', 'search', 'tool.json')
  fs.mkdirSync(path.dirname(profileManifest), { recursive: true })
  fs.writeFileSync(profileManifest, JSON.stringify({ binaries: {} }))

  expect(definition.generate()).not.toContain('documents.search:')
})
