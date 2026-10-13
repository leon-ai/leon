import { describe, expect, it, vi } from 'vitest'

import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { SystemHelper } from '@/helpers/system-helper'

describe('terminal application discovery', () => {
  it('retains ancestry before sampling and distinguishes a TUI from a background process without reading arguments', () => {
    vi.spyOn(SystemHelper, 'isWindows').mockReturnValue(false)
    const probe = new ContextProbeHelper()
    const command = vi.spyOn(probe, 'runCommand').mockReturnValue([
      '10 1 ? 0 100 200 /opt/Terminal App',
      '11 10 pts/0 0 100 100 bash',
      '12 11 pts/0 30 1000 50 assistant-tui',
      '13 1 ? 20 1000 50 assistant-tui',
      // Malformed rows and cycles must not break the entire snapshot.
      'malformed',
      '14 14 ? 0 100 10 cycle'
    ].join('\n'))
    const snapshot = probe.probeRunningProcesses(2)
    expect(snapshot.entries[0]).toMatchObject({
      pid: 12, parentPid: 11, terminal: 'pts/0', ancestors: ['bash', 'Terminal App']
    })
    expect(snapshot.entries[1]).toMatchObject({ pid: 13, ancestors: [] })
    expect(snapshot.entries[1]?.terminal).toBeUndefined()
    expect(probe.probeRunningProcesses().entries.find((entry) => entry.pid === 14)?.ancestors).toEqual([])
    expect(command).toHaveBeenCalledWith('ps', ['-ww', '-eo', 'pid=,ppid=,tty=,%cpu=,rss=,etimes=,comm='])
  })

  it('parses macOS elapsed time and executable paths with spaces via the fallback probe', () => {
    vi.spyOn(SystemHelper, 'isWindows').mockReturnValue(false)
    const probe = new ContextProbeHelper()
    vi.spyOn(probe, 'runCommand').mockReturnValueOnce('').mockReturnValueOnce(
      '12 11 ttys001 0.5 2048 1-02:03:04 /Applications/Terminal App.app/Contents/MacOS/Terminal App'
    )
    expect(probe.probeRunningProcesses().entries[0]).toMatchObject({
      pid: 12, parentPid: 11, terminal: 'ttys001', memoryMb: 2,
      runtimeSeconds: 93_784, name: '/Applications/Terminal App.app/Contents/MacOS/Terminal App'
    })
  })
})
