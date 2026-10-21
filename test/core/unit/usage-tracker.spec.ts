import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UsageCommand } from '@/built-in-command/commands/usage-command/usage-command'
import type { BuiltInCommandExecutionContext } from '@/built-in-command/built-in-command'
import { runWithProfileContext, getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession, recordTurnInference } from '@/core/session-manager/session-context'
import { trackInferenceUsage } from '@/core/llm-manager/llm-usage'
import { appendInferenceUsage, readInferenceUsage, HISTORICAL_USAGE_FILENAME, type InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { recordInferenceUsage, recordInferenceUsageOutcome } from '@/core/llm-manager/llm-usage/usage-context'
import { trackProviderResponseUsage } from '@/core/llm-manager/llm-usage/provider-response-usage'
import { createInferenceMetadata, InferenceAuthMode, InferenceCredentialSource } from '@/core/llm-manager/inference-metadata'
import { LogHelper } from '@/helpers/log-helper'

const runtime = vi.hoisted(() => ({ directory: '' }))

vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (profileName = getActiveProfileName()): { logs: string } => ({
    logs: path.join(runtime.directory, profileName, 'logs')
  })
}))
vi.mock('@/core/session-manager', () => ({
  CONVERSATION_SESSION_MANAGER: { getCurrentSessionId: (): string => 'current-session' }
}))
vi.mock('@/config', () => ({
  CONFIG_MANAGER: { getConfig: (): { time_zone: string } => ({ time_zone: 'America/New_York' }) }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { warning: vi.fn() }
}))

const TARGET = { provider: 'openrouter', model: 'vendor/model', purpose: 'react' }

async function records(): Promise<InferenceUsageRecord[]> {
  const result: InferenceUsageRecord[] = []

  for await (const record of readInferenceUsage({})) {
    result.push(record)
  }

  return result
}

function recordAt(timestamp: string, input: Partial<InferenceUsageRecord> = {}): InferenceUsageRecord {
  return {
    id: timestamp,
    startedAt: Date.parse(timestamp),
    finishedAt: Date.parse(timestamp),
    sessionId: 'current-session',
    ...TARGET,
    outcome: 'completed',
    usage: { inputTokens: 100, outputTokens: 20 },
    ...input
  }
}

async function command(period: string): Promise<string> {
  const response = await new UsageCommand().execute({
    args: period ? [period] : []
  } as BuiltInCommandExecutionContext)

  return response.result.plain_text.join('\n')
}

describe('inference usage', () => {
  beforeEach(async () => {
    runtime.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-usage-'))
  })

  afterEach(async () => {
    await fs.rm(runtime.directory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('persists concurrent profile and session attribution without credential contents', async () => {
    await Promise.all(['owner-a', 'owner-b'].map((profileName) =>
      runWithProfileContext({ profileName }, () => runWithConversationSession(
        { sessionId: profileName },
        () => trackInferenceUsage({ ...TARGET, model: profileName }, async () => {
          await Promise.resolve()
          recordTurnInference(createInferenceMetadata({
            provider: TARGET.provider,
            model: profileName,
            authMode: InferenceAuthMode.APIKey,
            credentialSource: InferenceCredentialSource.AccountBinding,
            connectionId: 'private-account',
            privateValues: ['private-key'],
            endpoint: 'https://provider.example/private-key?key=private-key'
          }))
          recordInferenceUsage({ prompt_tokens: 100, completion_tokens: 0 })
          recordInferenceUsageOutcome('completed')
        })
      ))
    ))

    for (const profileName of ['owner-a', 'owner-b']) {
      const saved = await runWithProfileContext({ profileName }, records)

      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({
        model: profileName,
        sessionId: profileName,
        inference: { model: profileName, authMode: 'api_key' },
        usage: { inputTokens: 100, outputTokens: 0 }
      })
      expect(JSON.stringify(saved)).not.toContain('private-key')
      expect(JSON.stringify(saved)).not.toContain('private-account')
    }

    await runWithProfileContext({ profileName: 'owner-a' }, () => runWithConversationSession(
      { sessionId: 'owner-a' },
      () => runWithProfileContext({ profileName: 'owner-c' }, () =>
        trackInferenceUsage(TARGET, async () => undefined)
      )
    ))
    const unrelated = await runWithProfileContext({ profileName: 'owner-c' }, records)

    expect(unrelated[0]?.sessionId).toBeNull()
  })

  it('keeps retry counters separate and preserves reported usage on unsuccessful attempts', async () => {
    await trackInferenceUsage(TARGET, async () => {
      recordInferenceUsage({ prompt_tokens: 100, completion_tokens: 10 })
      recordInferenceUsage({ prompt_tokens: 100, completion_tokens: 10 })
      recordInferenceUsageOutcome('failed')

      return trackInferenceUsage({ ...TARGET, model: 'another/model' }, async () => {
        // SDK totals include cache reads/writes even when the raw input count does not.
        recordInferenceUsage({
          inputTokens: { total: 200 },
          outputTokens: { total: 20 },
          raw: {
            input_tokens: 50,
            output_tokens: 20,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
            output_tokens_details: { thinking_tokens: 5 }
          }
        })
        recordInferenceUsageOutcome('completed')
      })
    })
    await trackInferenceUsage(TARGET, async () => {
      recordInferenceUsage({ inputTokens: { total: undefined }, outputTokens: { total: undefined } })
      recordInferenceUsage({ inputTokens: { total: 0 }, outputTokens: { total: 0 }, raw: undefined })
    })

    const saved = await records()

    expect(new Set(saved.map((record) => record.id)).size).toBe(3)
    expect(saved.find((record) => record.model === 'another/model')).toMatchObject({
      outcome: 'completed',
      usage: {
        inputTokens: 200,
        outputTokens: 20,
        cachedInputTokens: 100,
        cacheWriteInputTokens: 50,
        reasoningOutputTokens: 5
      }
    })
    expect(saved.filter((record) => record.model === TARGET.model).map((record) => record.usage))
      .toEqual([{ inputTokens: 100, outputTokens: 10 }, {}])
  })

  it('reports owner-local days, session history, models and partial cost coverage', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const inference = createInferenceMetadata({
      provider: 'openrouter',
      model: 'kimi',
      authMode: InferenceAuthMode.APIKey,
      credentialSource: InferenceCredentialSource.AccountBinding,
      connectionId: 'openrouter-owner',
      endpoint: 'https://provider.example/responses'
    })
    const profileName = getActiveProfileName()

    await appendInferenceUsage(profileName, recordAt('2026-10-09T03:59:59Z', { model: 'previous-day' }))
    await appendInferenceUsage(profileName, recordAt('2026-10-09T04:00:00Z', {
      model: 'kimi', inference, usage: { inputTokens: 100, outputTokens: 20, costUSD: 0.25 }
    }))
    await appendInferenceUsage(profileName, recordAt('2026-10-09T05:00:00Z', {
      model: 'kimi', inference, purpose: 'memory', usage: {}, outcome: 'failed'
    }))
    await appendInferenceUsage(profileName, recordAt('2026-10-09T06:00:00Z', {
      model: 'xiaomi', sessionId: 'other-session',
      usage: { inputTokens: 10, outputTokens: 5, costUSD: 99, costEstimated: true }
    }))
    await appendInferenceUsage(profileName, recordAt('2026-10-02T12:00:00Z', { model: 'older-model' }))

    const today = await command('today')
    const week = await command('week')
    const session = await command('session')

    expect(today).toContain('3 requests')
    expect(today).toContain('Input: 110 (2/3 requests reported)')
    expect(today).toContain('Total tokens: 135 (2/3 requests reported)')
    expect(today).toContain('Reported cost: $0.25 (1/3 requests reported)')
    expect(today).toContain('openrouter / kimi / API key / connection')
    expect(today).toContain('openrouter / xiaomi')
    expect(today).toContain('memory')
    expect(today).not.toContain('previous-day')
    expect(today).not.toContain('older-model')
    expect(week).toContain('4 requests')
    expect(week).toContain('2026-10-08')
    expect(session).toContain('older-model')
    expect(session).not.toContain('xiaomi')
    const lifetime = await command('')

    expect(lifetime).toContain('Leon Usage — lifetime')
    expect(lifetime).toContain('5 requests')
    expect(lifetime).toContain('older-model')
  })

  it('filters historical turns by date and session without treating them as live attempts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const profileName = getActiveProfileName()

    await appendInferenceUsage(profileName, recordAt('2026-10-09T05:00:00Z'))
    const history = [
      recordAt('2026-09-01T12:00:00Z', {
        model: 'historical-model', outcome: 'unknown', historical: { completionCount: 12 }
      }),
      recordAt('2026-10-08T12:00:00Z', {
        sessionId: 'other-session', model: 'unknown', outcome: 'unknown', historical: {}
      })
    ]

    await fs.writeFile(
      path.join(runtime.directory, profileName, 'logs', 'usage', HISTORICAL_USAGE_FILENAME),
      history.map((record) => JSON.stringify(record)).join('\n')
    )
    const lifetime = await command('')

    expect(lifetime).toContain('1 requests · 2 historical turns · 12 recorded historical completions')
    expect(lifetime).toContain('1 historical turns without completion counts')
    expect(lifetime).toContain('Total tokens: 360')
    expect(lifetime).not.toContain('unsuccessful')
    expect(await command('today')).toContain('1 requests · Total tokens: 120')
    expect(await command('today')).not.toContain('historical-model')
    expect(await command('week')).toContain('1 historical turns')
    expect(await command('session')).toContain('historical-model')
    expect(await command('session')).not.toContain('openrouter / unknown')
    expect(await runWithProfileContext({ profileName: 'other-owner' }, () => command('')))
      .toContain('No recorded requests')
  })

  it('keeps inference responses usable when the ledger cannot be written', async () => {
    await fs.writeFile(path.join(runtime.directory, getActiveProfileName()), '')

    await expect(trackInferenceUsage(TARGET, async () => 'answer')).resolves.toBe('answer')
    expect(LogHelper.warning).toHaveBeenCalledWith(expect.stringContaining('Could not save inference usage'))
  })

  it('attributes streamed tool usage to its initiating profile and session without changing bytes', async () => {
    const text = [
      'data: {"type":"response.output_text.delta","delta":"private answer 世界"}\r\n\r\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":120,"output_tokens":20,"input_tokens_details":{"cached_tokens":80}}}}\r\n\r\n'
    ].join('')
    const bytes = new TextEncoder().encode(text)
    const response = await runWithProfileContext({ profileName: 'tool-owner' }, () =>
      runWithConversationSession({ sessionId: 'tool-session' }, () => trackProviderResponseUsage(
        createInferenceMetadata({
          provider: 'openai', model: 'search-model',
          authMode: InferenceAuthMode.ChatGPTOAuth,
          credentialSource: InferenceCredentialSource.AccountBinding,
          endpoint: 'https://provider.example/responses'
        }),
        async () => new Response(new ReadableStream({
          start(controller): void {
            for (const byte of bytes) {
              controller.enqueue(Uint8Array.of(byte))
            }
            controller.close()
          }
        }), { headers: { 'content-type': 'text/event-stream' } })
      ))
    )

    expect(await records()).toEqual([])
    expect(await response.text()).toBe(text)
    const saved = await runWithProfileContext({ profileName: 'tool-owner' }, records)

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      sessionId: 'tool-session', purpose: 'provider-tool', outcome: 'completed',
      usage: { inputTokens: 120, outputTokens: 20, cachedInputTokens: 80 }
    })
    expect(JSON.stringify(saved)).not.toContain('private answer')
    expect(await records()).toEqual([])
  })

  it('merges streamed cache counters and preserves reported usage on failure or cancellation', async () => {
    const inference = createInferenceMetadata({
      ...TARGET, authMode: InferenceAuthMode.APIKey,
      credentialSource: InferenceCredentialSource.ProfileAPIKey,
      endpoint: 'https://provider.example/messages'
    })
    const stream = await trackProviderResponseUsage(inference, async () => new Response([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":0,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":20}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":20}}\n\n',
      'data: {"type":"error","error":{"message":"private error"}}\n\n'
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }))
    await stream.text()

    const canceled = await trackProviderResponseUsage(inference, async () => new Response(
      new ReadableStream({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode('data: {"usage":{"prompt_tokens":10}}\n\n'))
        }
      }), { headers: { 'content-type': 'text/event-stream' } }
    ))
    const reader = canceled.body!.getReader()
    await reader.read()
    await reader.cancel()

    const controller = new AbortController()
    const unread = await trackProviderResponseUsage(inference, async () => new Response(
      new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }
    ), controller.signal)
    controller.abort()
    await unread.body!.cancel()

    await expect(trackProviderResponseUsage(inference, async () => {
      throw new Error('Transport unavailable')
    })).rejects.toThrow('Transport unavailable')
    const saved = await records()

    expect(saved.map((record) => ({ outcome: record.outcome, usage: record.usage }))).toEqual([
      { outcome: 'failed', usage: {
        inputTokens: 200, outputTokens: 20, cachedInputTokens: 100, cacheWriteInputTokens: 50
      } },
      { outcome: 'canceled', usage: { inputTokens: 10 } },
      { outcome: 'canceled', usage: {} },
      { outcome: 'failed', usage: {} }
    ])
  })

  it('records JSON tool usage and bounds observation without dropping oversized provider content', async () => {
    const inference = createInferenceMetadata({
      ...TARGET, authMode: InferenceAuthMode.APIKey,
      credentialSource: InferenceCredentialSource.ProfileAPIKey,
      endpoint: 'https://provider.example/chat/completions'
    })
    const json = { usage: { prompt_tokens: 90, completion_tokens: 10, prompt_cache_hit_tokens: 60 } }
    const response = await trackProviderResponseUsage(inference, async () => Response.json(json))
    expect(await response.json()).toEqual(json)

    const text = `data: ${JSON.stringify({ content: 'x'.repeat(1_048_577) })}\n\n` +
      'data: {"usage":{"prompt_tokens":30,"completion_tokens":5}}\n\ndata: [DONE]\n\n'
    const large = await trackProviderResponseUsage(inference, async () => new Response(text, {
      headers: { 'content-type': 'text/event-stream' }
    }))
    expect(await large.text()).toBe(text)
    expect((await records()).map((record) => record.usage)).toEqual([
      { inputTokens: 90, outputTokens: 10, cachedInputTokens: 60 },
      { inputTokens: 30, outputTokens: 5 }
    ])
  })
})
