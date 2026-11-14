import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ToolCallLogger, type OwnerQueryToolCallRecord } from '@/tool-call-logger'

const fixture = vi.hoisted(() => ({ logs: '' }))
const SECRET = 'fake-credential_0123456789'
const REDACTED_SECRET = '[REDACTED_SECRET]'

vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): { logs: string } => ({ logs: fixture.logs })
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), success: vi.fn(), error: vi.fn() }
}))
vi.mock('@/helpers/date-helper', () => ({
  DateHelper: { getDateTime: (): string => new Date().toISOString() }
}))

afterEach(async () => {
  vi.clearAllTimers()
  vi.useRealTimers()

  if (fixture.logs) {
    await fs.rm(fixture.logs, { recursive: true, force: true })
  }
})

describe('tool call log privacy', () => {
  it('keeps credentials out of persisted records, output artifacts and recent context', async () => {
    fixture.logs = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-tool-call-logs-'))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })

    const logger = new ToolCallLogger({
      loggerName: 'Tool call fixture', fileName: 'tool-calls.json', nbOfLogsToKeep: 8
    })
    const output = {
      stdout: `DB_PASSWORD=${SECRET}\n${JSON.stringify({ access_token: SECRET })}`
    }
    const safeOutput = {
      stdout: `DB_PASSWORD=${REDACTED_SECRET}\n${JSON.stringify({ access_token: REDACTED_SECRET })}`
    }
    const command = `GITHUB_TOKEN=${SECRET}`
    const safeCommand = `GITHUB_TOKEN=${REDACTED_SECRET}`
    const outputLogPath = await logger.runOwnerQuery(
      `OPENAI_API_KEY=${SECRET}`,
      async () => {
        logger.recordToolCall({
          toolkitId: 'operating_system_control', toolId: 'shell',
          functionName: 'executeCommand', params: { command }
        })

        return logger.recordToolOutput({
          toolkitId: 'operating_system_control', toolId: 'shell',
          functionName: 'executeCommand', status: 'success',
          message: `client_secret=${SECRET}`,
          rawInput: JSON.stringify({ command }), parsedInput: { command }, output
        })
      }
    )

    expect(outputLogPath).not.toBeNull()

    const recordText = await fs.readFile(path.join(fixture.logs, 'tool-calls.json'), 'utf-8')
    const records = JSON.parse(recordText) as OwnerQueryToolCallRecord[]
    const artifact = await fs.readFile(outputLogPath!, 'utf-8')
    const manifest = await logger.getRecentArtifactManifest()

    for (const text of [recordText, artifact, manifest]) {
      expect(text).not.toContain(SECRET)
      expect(text).toContain(REDACTED_SECRET)
    }

    expect(records[0]).toMatchObject({
      ownerQuery: `OPENAI_API_KEY=${REDACTED_SECRET}`,
      toolCalls: [{
        params: { command: safeCommand },
        message: `client_secret=${REDACTED_SECRET}`,
        outputPreview: safeOutput.stdout.replace(/\s+/g, ' ')
      }]
    })
    expect(JSON.parse(artifact.split('\nOutput:\n')[1]!)).toEqual(safeOutput)
    expect(output.stdout).toContain(SECRET)
  })
})
