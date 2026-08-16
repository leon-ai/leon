import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BuiltInCommandExecutionContext } from '@/built-in-command/built-in-command'
import { DownloadCommand } from '@/built-in-command/commands/download-command/download-command'
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
})
