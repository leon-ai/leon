import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHash } from 'node:crypto'

import {
  refreshChatGPTAccount,
  startChatGPTSignIn
} from '@/core/llm-manager/llm-accounts/llm-account-chatgpt'
import {
  CHATGPT_ACCOUNT_CLAIM,
  CHATGPT_CODEX_CLIENT_ID
} from '@/core/llm-manager/llm-accounts/chatgpt-account-config'
import { LogHelper } from '@/helpers/log-helper'

const account = vi.hoisted(() => ({
  directory: '', profile: 'test-owner', publicKey: undefined as Awaited<ReturnType<typeof generateKeyPair>>['publicKey'] | undefined,
  get: vi.fn(), save: vi.fn(), use: vi.fn()
}))
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  MODEL_ACCOUNT_STORE: { getCredentials: account.get, save: account.save },
  useModelAccount: account.use
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { info: vi.fn(), error: vi.fn() }
}))
vi.mock('@/leon-roots', () => ({
  CODEBASE_PATH: process.cwd(),
  get LEON_HOME_PATH(): string {
    return account.directory
  }
}))
vi.mock('@/core/profile-runtime/profile-context', () => ({
  getActiveProfileName: (): string => account.profile,
  runWithProfileContext: async (_context: unknown, run: () => Promise<unknown>): Promise<unknown> => run()
}))
vi.mock('jose', async (importOriginal) => ({
  ...await importOriginal<typeof import('jose')>(),
  // Verify signatures normally, using a test issuer key instead of network JWKS.
  createRemoteJWKSet: (): (() => Promise<typeof account.publicKey>) => async (): Promise<typeof account.publicKey> => account.publicKey
}))

const browserFetch = globalThis.fetch
const listen = http.Server.prototype.listen
const pending: (() => void)[] = []

beforeEach(async () => {
  account.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-chatgpt-test-'))
  account.profile = 'test-owner'
  account.get.mockResolvedValue(null)
  account.save.mockImplementation(async (input) => input)
  let callbackPort = 0

  // Reserve an isolated port, then reuse it to exercise real reconnect collisions.
  vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (
    this: http.Server,
    ...args: unknown[]
  ): http.Server {
    return Reflect.apply(listen, this, [callbackPort, '127.0.0.1', (): void => {
      const address = this.address() as import('node:net').AddressInfo
      callbackPort = address.port
      const ready = args[2] as () => void
      ready()
    }]) as http.Server
  })
})
afterEach(async () => {
  pending.splice(0).forEach((cancel) => cancel())
  vi.restoreAllMocks()
  await fs.rm(account.directory, { recursive: true, force: true })
})

describe('ChatGPT sign-in', () => {
  it('serializes concurrent reconnects and rejects the retired browser state', async () => {
    const [first, second] = await Promise.all([
      startChatGPTSignIn(),
      startChatGPTSignIn()
    ])
    pending.push(first.cancel, second.cancel)

    await expect(first.complete).rejects.toThrow('sign-in ended')
    await expect(first.complete).rejects.toMatchObject({ name: 'AbortError' })
    expect(LogHelper.error).not.toHaveBeenCalled()
    const callback = new URL(new URL(second.url).searchParams.get('redirect_uri')!)
    expect(callback.port).toBe(new URL(new URL(first.url).searchParams.get('redirect_uri')!).port)
    callback.searchParams.set('state', new URL(first.url).searchParams.get('state')!)
    callback.searchParams.set('code', 'retired-code')
    const exchange = vi.spyOn(globalThis, 'fetch')
    const page = await browserFetch(callback)

    expect(page.status).toBe(400)
    await page.text()
    expect(exchange).not.toHaveBeenCalled()
    expect(account.save).not.toHaveBeenCalled()
  })

  it('reports an occupied port without retiring a different profile sign-in', async () => {
    const first = await startChatGPTSignIn()
    pending.push(first.cancel)
    let firstEnded = false
    void first.complete.catch(() => {
      firstEnded = true
    })
    account.profile = 'another-owner'
    vi.mocked(http.Server.prototype.listen).mockImplementationOnce(function (
      this: http.Server
    ): http.Server {
      queueMicrotask(() => {
        this.emit('error', Object.assign(new Error('listen EADDRINUSE'), {
          code: 'EADDRINUSE'
        }))
      })

      return this
    })

    await expect(startChatGPTSignIn()).rejects.toThrow(
      'Port 1455 is already in use by another profile or application.'
    )

    expect(firstEnded).toBe(false)
    const callback = new URL(new URL(first.url).searchParams.get('redirect_uri')!)
    const page = await browserFetch(callback)
    expect(page.status).toBe(400)
    await page.text()
    first.cancel()
    await expect(first.complete).rejects.toThrow('sign-in ended')

    const retry = await startChatGPTSignIn()
    pending.push(retry.cancel)
  })

  it('returns a token exchange timeout without exposing raw authorization data', async () => {
    const signIn = await startChatGPTSignIn()
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'private-code')
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('private-code private-token', 'TimeoutError')
    )
    const page = await browserFetch(callback)

    await expect(signIn.complete).rejects.toThrow('during token exchange: The request timed out after 30 seconds.')
    await signIn.complete.catch((error: Error) => {
      expect(error.message).not.toContain('private-')
    })
    await page.text()
    expect(account.save).not.toHaveBeenCalled()
    expect(LogHelper.error).not.toHaveBeenCalled()
  })

  it('distinguishes an expired browser authorization from a server request timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const signIn = await startChatGPTSignIn()
      pending.push(signIn.cancel)
      const expired = expect(signIn.complete).rejects.toThrow(
        'during browser authorization: Browser authorization timed out before Leon received the callback.'
      )

      await vi.advanceTimersByTimeAsync(600_000)
      await expired
      expect(account.save).not.toHaveBeenCalled()
      expect(LogHelper.error).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not save or select an account when canceled during model lookup', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    account.publicKey = publicKey
    const signIn = await startChatGPTSignIn()
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    const token = await new SignJWT({
      nonce: authorize.searchParams.get('nonce'),
      [CHATGPT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'workspace' }
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com').setAudience(CHATGPT_CODEX_CLIENT_ID)
      .setSubject('test-owner').setExpirationTime('1h').sign(privateKey)
    let finishModels!: (response: Response) => void
    // Deliberately ignore abort in the mock: late responses must still be blocked.
    const exchange = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        access_token: 'test-access', id_token: token,
        expires_in: 3_600
      }))
      .mockImplementationOnce(() =>
        new Promise<Response>((resolve) => {
          finishModels = resolve
        })
      )
    const page = await browserFetch(callback)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const reader = page.body!.getReader()
    const initial = new TextDecoder().decode((await reader.read()).value)
    expect(initial).toContain('Connecting your ChatGPT account')
    expect(initial).not.toContain('ChatGPT connected')
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2))
    signIn.cancel()
    await expect(signIn.complete).rejects.toThrow('sign-in ended')
    const final = new TextDecoder().decode((await reader.read()).value)
    expect(final).toContain('Unable to connect ChatGPT')
    expect(final).not.toContain('ChatGPT connected')
    await reader.cancel()
    expect(exchange.mock.calls[1]![1]!.signal!.aborted).toBe(true)

    finishModels(Response.json({ models: [{ slug: 'test-model', visibility: 'list' }] }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(account.save).not.toHaveBeenCalled()
    expect(account.use).not.toHaveBeenCalled()
  })

  it.each([
    { failure: null, detail: '' },
    { failure: 'nonce', detail: 'during identity verification: The operation was rejected or could not be completed.' }
  ])('validates state, signed identity and PKCE before saving (failure: $failure)', async ({ failure, detail }) => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    account.publicKey = publicKey
    const signIn = await startChatGPTSignIn()
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    expect(authorize.pathname).toBe('/oauth/authorize')
    expect(authorize.searchParams.get('client_id')).toBe(CHATGPT_CODEX_CLIENT_ID)
    expect(authorize.searchParams.get('scope')).toBe('openid profile email offline_access')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.has('resource')).toBe(false)

    const token = await new SignJWT({
      nonce: failure === 'nonce' ? 'wrong' : authorize.searchParams.get('nonce'),
      [CHATGPT_ACCOUNT_CLAIM]: failure === 'workspace' ? {} : { chatgpt_account_id: 'workspace' }
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com')
      .setAudience(failure === 'audience' ? 'another-client' : CHATGPT_CODEX_CLIENT_ID)
      .setSubject('test-owner')
      .setExpirationTime(failure === 'expiration' ? Math.floor(Date.now() / 1_000) - 1 : '1h')
      .sign(failure === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey)
    const exchange = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        access_token: 'test-access', refresh_token: 'test-refresh', id_token: token,
        expires_in: 3_600
      }))
      .mockResolvedValueOnce(Response.json({ models: [{ slug: 'test-model', visibility: 'list' }] }))
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('state', 'wrong-state')
    const invalidPage = await browserFetch(callback)
    expect(invalidPage.status).toBe(400)
    expect(await invalidPage.text()).toContain('Unable to connect ChatGPT')
    expect(exchange).not.toHaveBeenCalled()

    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    const page = await browserFetch(callback)
    expect(page.status).toBe(200)
    if (failure) {
      await expect(signIn.complete).rejects.toThrow(detail)
      const html = await page.text()
      expect(html).toContain('Unable to connect ChatGPT')
      expect(html).not.toContain('ChatGPT connected')
      expect(account.save).not.toHaveBeenCalled()
      expect(account.use).not.toHaveBeenCalled()
    } else {
      await signIn.complete
      expect(await page.text()).toContain('ChatGPT connected')
      const form = new URLSearchParams(exchange.mock.calls[0]![1]!.body as string)
      expect(exchange.mock.calls[0]![0]).toBe('https://auth.openai.com/oauth/token')
      expect(form.get('client_id')).toBe(CHATGPT_CODEX_CLIENT_ID)
      expect(form.has('resource')).toBe(false)
      expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url'))
        .toBe(authorize.searchParams.get('code_challenge'))
      expect(form.get('redirect_uri')).toBe(authorize.searchParams.get('redirect_uri'))
      const modelsURL = new URL(String(exchange.mock.calls[1]![0]))
      expect(modelsURL.origin + modelsURL.pathname).toBe('https://chatgpt.com/backend-api/codex/models')
      expect(modelsURL.searchParams.get('client_version')).toBeTruthy()
      expect(new Headers(exchange.mock.calls[1]![1]!.headers).get('chatgpt-account-id')).toBe('workspace')
      expect(account.save).toHaveBeenCalledWith(expect.objectContaining({
        credentials: expect.objectContaining({
          subject: 'test-owner', client_id: CHATGPT_CODEX_CLIENT_ID, model: 'test-model',
          auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace'
        })
      }))
      expect(account.use).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^openai\./), 'test-model')
    }
  })

  it.each([
    { legacy: false, sameOwner: true, modelStatus: 200 },
    { legacy: false, sameOwner: false, modelStatus: 200 }
  ])('reconnects expired credentials after verification (legacy=$legacy, same subject=$sameOwner, models HTTP=$modelStatus)', async ({ legacy, sameOwner, modelStatus }) => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    account.publicKey = publicKey
    account.get.mockResolvedValueOnce({
      auth_kind: 'chatgpt', client_id: legacy ? 'oaiapp_saved' : CHATGPT_CODEX_CLIENT_ID,
      subject: 'owner',
      ext_agent_host_id: 'urn:uuid:test', expires_at: 1
    })
    const signIn = await startChatGPTSignIn('openai.saved')
    pending.push(signIn.cancel)
    expect(account.get).toHaveBeenCalledWith('openai.saved', undefined, false, false)
    const authorize = new URL(signIn.url)
    expect(authorize.searchParams.get('client_id')).toBe(CHATGPT_CODEX_CLIENT_ID)
    expect(authorize.searchParams.has('agent_name_hint')).toBe(false)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    // Legacy client subjects differ; same-client reconnects must retain the owner.
    const token = await new SignJWT({
      [CHATGPT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'workspace' }
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com').setAudience(CHATGPT_CODEX_CLIENT_ID)
      .setSubject(sameOwner ? 'owner' : 'other-owner').setExpirationTime('1h').sign(privateKey)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        access_token: 'test-access', id_token: token, expires_in: 3_600
      }))
      .mockResolvedValueOnce(Response.json(
        { models: [{ slug: 'test-model', visibility: 'list' }] },
        { status: modelStatus }
      ))
    const page = await browserFetch(callback)
    if ((legacy || sameOwner) && modelStatus === 200) {
      await signIn.complete
      expect(account.save).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'openai.saved',
        credentials: expect.objectContaining({
          auth_flow: 'codex', subject: sameOwner ? 'owner' : 'other-owner'
        })
      }))
      expect(account.use).toHaveBeenCalledWith('openai.saved', 'test-model')
    } else {
      await expect(signIn.complete).rejects.toThrow(
        modelStatus !== 200
          ? 'during model discovery: OpenAI returned HTTP 503.'
          : 'during identity verification: The operation was rejected or could not be completed.'
      )
      expect(account.save).not.toHaveBeenCalled()
      expect(account.use).not.toHaveBeenCalled()
    }
    await page.text()
  })

  it('refreshes Codex tokens without changing the account or requiring token-sharing scopes', async () => {
    const exchange = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      access_token: 'new-token', expires_in: 3_600, scope: 'openid profile email offline_access'
    }))
    const credentials = {
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
      client_id: CHATGPT_CODEX_CLIENT_ID, refresh_token: 'refresh-token', access_token: 'old-token'
    }
    expect(await refreshChatGPTAccount(credentials)).toMatchObject({
      ...credentials, access_token: 'new-token'
    })
    expect(exchange.mock.calls[0]![0]).toBe('https://auth.openai.com/oauth/token')
  })

  it('requires re-sign-in for token-sharing credentials without sending them to Codex', async () => {
    const exchange = vi.spyOn(globalThis, 'fetch')
    await expect(refreshChatGPTAccount({
      auth_kind: 'chatgpt', client_id: 'dynamic-client',
      access_token: 'token-sharing-token', refresh_token: 'old-refresh'
    })).rejects.toThrow('reconnect your ChatGPT subscription')
    expect(exchange).not.toHaveBeenCalled()
  })
})
