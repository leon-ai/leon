import { describe, expect, it, vi } from 'vitest'

import ToolkitRegistry from '@/core/tool-manager/toolkit-registry'
import type { SatelliteToolkitDefinition } from '@/core/satellite/types'
import { runWithSelectedDevice } from '@/core/satellite/device-context'
import { ToolExecutionTarget } from '@@/bridges/runtime/contracts/device-execution'
import { ToolConcurrency } from '@/types'

vi.mock('@/constants', () => ({ TOOLS_PATH: '/unused' }))
vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): { satellite: { tools: Record<string, string> } } => ({
  satellite: { tools: { 'computer_use.cua': 'owner-device' } }
}) } }))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {} }))
vi.mock('@/helpers/log-helper', () => ({ LogHelper: { title: vi.fn(), success: vi.fn() } }))
vi.mock('@/leon-roots', () => ({ resolveToolDirectory: vi.fn(), LEON_PROFILE_NAME: 'owner' }))
vi.mock('@/helpers/profile-helper', () => ({ ProfileHelper: { isToolDisabled: (): boolean => false } }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({ getProfilePaths: (): { name: string } => ({ name: 'owner' }) }))

const TOOLKIT: SatelliteToolkitDefinition = {
  id: 'computer_use', name: 'Computer', description: 'Device tools', icon_name: 'computer',
  tools: { cua: { tool_id: 'cua', toolkit_id: 'computer_use', name: 'Cua', description: 'Native tools', functions: {
    click: { description: 'Click a target.', progressive_guidance: 'Use the latest observed target.', parameters: {} }
  } } }
}

describe('Satellite tool ownership', () => {
  it('keeps paired devices scoped to the selected command and reports an offline device', () => {
    const registry = new ToolkitRegistry()
    vi.spyOn(registry, 'getToolExecutionTarget').mockReturnValue(ToolExecutionTarget.Device)
    const toolkit = { ...TOOLKIT, id: 'device_tools' }
    registry.registerSatelliteTools('first-device', [toolkit], true)
    registry.registerSatelliteTools('second-device', [toolkit], true)

    expect(registry.getToolSatelliteDevice(toolkit.id, 'cua')).toBeNull()
    expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(false)
    runWithSelectedDevice('first-device', () => {
      expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(true)
      expect(Object.keys(registry.getToolFunctions(toolkit.id, 'cua')!)).toEqual(['click'])
      registry.removeSatelliteTools('first-device')
      expect(registry.getToolSatelliteDevice(toolkit.id, 'cua')).toBe('first-device')
      expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(false)
    })
    runWithSelectedDevice('second-device', () => {
      expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(true)
    })
  })

  it('keeps a server-only tool on the server host even when a Satellite advertises it', () => {
    const registry = new ToolkitRegistry()
    vi.spyOn(registry, 'getToolExecutionTarget').mockReturnValue(ToolExecutionTarget.Core)
    registry.registerSatelliteTools('owner-device', [TOOLKIT])

    runWithSelectedDevice('owner-device', () => {
      expect(registry.getToolSatelliteDevice('computer_use', 'cua')).toBeNull()
    })
  })

  it('preserves per-function concurrency overrides from a Satellite manifest', () => {
    const registry = new ToolkitRegistry()
    registry.registerSatelliteTools('owner-device', [{
      ...TOOLKIT,
      tools: {
        cua: {
          ...TOOLKIT.tools['cua']!,
          concurrency: ToolConcurrency.Serial,
          functions: {
            click: TOOLKIT.tools['cua']!.functions['click']!,
            inspect: {
              description: 'Inspect an isolated resource.',
              concurrency: ToolConcurrency.Parallel,
              parameters: {}
            }
          }
        }
      }
    }])

    expect(registry.getToolConcurrency('computer_use', 'cua', 'click')).toBe(ToolConcurrency.Serial)
    expect(registry.getToolConcurrency('computer_use', 'cua', 'inspect')).toBe(ToolConcurrency.Parallel)
    expect(registry.getToolConcurrency('unknown', 'tool')).toBe(ToolConcurrency.Parallel)
    expect(registry.getToolFunctions('computer_use', 'cua')?.['inspect']?.concurrency)
      .toBe(ToolConcurrency.Parallel)
  })

  it('retains a binding before connection and after disconnect, ignoring other devices', () => {
    const registry = new ToolkitRegistry()
    expect(registry.getToolSatelliteDevice('computer_use', 'cua')).toBe('owner-device')
    expect(registry.isToolAvailable('computer_use', 'cua')).toBe(false)
    registry.registerSatelliteTools('different-device', [TOOLKIT])
    expect(registry.isToolAvailable('computer_use', 'cua')).toBe(false)
    registry.registerSatelliteTools('owner-device', [TOOLKIT])
    expect(registry.isToolAvailable('computer_use', 'cua')).toBe(true)
    expect(registry.getToolFunctions('computer_use', 'cua')?.['click']?.progressive_guidance)
      .toBe('Use the latest observed target.')
    registry.removeSatelliteTools('owner-device')
    expect(registry.getToolSatelliteDevice('computer_use', 'cua')).toBe('owner-device')
    expect(registry.isToolAvailable('computer_use', 'cua')).toBe(false)
    registry.registerSatelliteTools('owner-device', [TOOLKIT])
    expect(registry.isToolAvailable('computer_use', 'cua')).toBe(true)
  })

  it('keeps a discovered device binding after disconnect instead of reverting to local', () => {
    const registry = new ToolkitRegistry()
    const toolkit = { ...TOOLKIT, id: 'device_tools' }
    expect(registry.getToolSatelliteDevice(toolkit.id, 'cua')).toBeNull()
    registry.registerSatelliteTools('discovered-device', [toolkit])
    expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(true)
    registry.removeSatelliteTools('discovered-device')
    expect(registry.getToolSatelliteDevice(toolkit.id, 'cua')).toBe('discovered-device')
    expect(registry.isToolAvailable(toolkit.id, 'cua')).toBe(false)
  })
})
