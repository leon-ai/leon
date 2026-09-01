import os from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import ToolExecutor from '@/core/tool-executor'

interface FilesystemValueNormalizer {
  normalizeFilesystemValues(value: unknown): unknown
}

describe('ToolExecutor filesystem value normalization', () => {
  it('does not reinterpret ordinary tool values as filesystem paths', () => {
    const executor = new ToolExecutor() as unknown as FilesystemValueNormalizer

    expect(
      executor.normalizeFilesystemValues({
        scope: 'desktop',
        target: { kind: 'desktop' }
      })
    ).toEqual({
      scope: 'desktop',
      target: { kind: 'desktop' }
    })
  })

  it('does not treat a temporary runtime directory as a user-home root', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/tmp/leon-isolated-home')
    const executor = new ToolExecutor() as unknown as FilesystemValueNormalizer
    const benchmarkArtifact = '/tmp/computer-use-run/result.txt'

    expect(executor.normalizeFilesystemValues(benchmarkArtifact)).toBe(
      benchmarkArtifact
    )
  })
})
