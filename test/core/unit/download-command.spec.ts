import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BuiltInCommandExecutionContext } from '@/built-in-command/built-in-command'
import { DownloadCommand } from '@/built-in-command/commands/download-command/download-command'
import { LLM_DIR_PATH } from '@/constants'
import { FileHelper } from '@/helpers/file-helper'

describe('DownloadCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses resumable parallel ranges for model downloads', async () => {
    const downloadSpy = vi
      .spyOn(FileHelper, 'downloadFile')
      .mockResolvedValue(undefined)
    const modelURL = 'https://example.com/model.gguf'
    const command = new DownloadCommand()

    const result = await command.execute({
      args: ['model', modelURL]
    } as BuiltInCommandExecutionContext)

    expect(result.status).toBe('completed')
    expect(downloadSpy).toHaveBeenCalledWith(
      modelURL,
      expect.stringMatching(/model\.gguf$/),
      {
        parallelStreams: 3
      }
    )
  })

  it('downloads the model inside the llm models folder', async () => {
    const downloadSpy = vi
      .spyOn(FileHelper, 'downloadFile')
      .mockResolvedValue(undefined)
    const command = new DownloadCommand()

    const result = await command.execute({
      args: ['model', 'https://example.com/sub/dir/model.gguf']
    } as BuiltInCommandExecutionContext)

    expect(result.status).toBe('completed')
    expect(downloadSpy).toHaveBeenCalledTimes(1)
    expect(downloadSpy.mock.calls[0]?.[1]).toBe(
      path.join(LLM_DIR_PATH, 'model.gguf')
    )
  })

  it('rejects encoded path traversal in the model download URL', async () => {
    const downloadSpy = vi
      .spyOn(FileHelper, 'downloadFile')
      .mockResolvedValue(undefined)
    const command = new DownloadCommand()
    // The file name carries traversal segments that stay encoded until
    // after the URL has been parsed.
    const maliciousURL = `https://example.com/models/${encodeURIComponent(
      '../../../evil.gguf'
    )}`

    const result = await command.execute({
      args: ['model', maliciousURL]
    } as BuiltInCommandExecutionContext)

    expect(result.status).toBe('error')
    expect(downloadSpy).not.toHaveBeenCalled()
  })

  it('rejects a model download URL whose file name decodes to a parent directory', async () => {
    const downloadSpy = vi
      .spyOn(FileHelper, 'downloadFile')
      .mockResolvedValue(undefined)
    const command = new DownloadCommand()

    const result = await command.execute({
      args: ['model', 'https://example.com/models/%2e%2e']
    } as BuiltInCommandExecutionContext)

    expect(result.status).toBe('error')
    expect(downloadSpy).not.toHaveBeenCalled()
  })
})
