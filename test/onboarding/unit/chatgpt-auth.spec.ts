import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startChatGPTSignIn } from '@/core/llm-manager/llm-accounts/llm-account-chatgpt'

const account = vi.hoisted(() => ({
  directory: '', publicKey: undefined as Awaited<ReturnType<typeof generateKeyPair>>['publicKey'] | undefined,
  get: vi.fn(), save: vi.fn(), use: vi.fn()
}))
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  MODEL_ACCOUNT_STORE: { getCredentials: account.get, save: account.save },
  useModelAccount: account.use
}))
vi.mock('@/leon-roots', () => ({
  get LEON_HOME_PATH(): string {
    return account.directory
  }
}))
vi.mock('@/core/profile-runtime/profile-context', () => ({
  getActiveProfileName: (): string => 'test-owner',
  runWithProfileContext: async (_context: unknown, run: () => Promise<unknown>): Promise<unknown> => run()
}))
vi.mock('jose', async (importOriginal) => ({
  ...await importOriginal<typeof import('jose')>(),
  // Verify signatures normally, using a test issuer key instead of network JWKS.
  createRemoteJWKSet: (): (() => Promise<typeof account.publicKey>) => async (): Promise<typeof account.publicKey> => account.publicKey
}))

const browserFetch = globalThis.fetch
const pending: (() => void)[] = []

beforeEach(async () => {
  account.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-chatgpt-test-'))
  account.get.mockResolvedValue(null)
  account.save.mockImplementation(async (input) => input)
})
afterEach(async () => {
  pending.splice(0).forEach((cancel) => cancel())
  vi.restoreAllMocks()
  await fs.rm(account.directory, { recursive: true, force: true })
})

describe('ChatGPT sign-in', () => {
  it('does not save or select an account when canceled during model lookup', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    account.publicKey = publicKey
    const signIn = await startChatGPTSignIn()
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('client_id', 'oaiapp_test')

    const token = await new SignJWT({ nonce: authorize.searchParams.get('nonce') })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com').setAudience('oaiapp_test')
      .setSubject('test-owner').setExpirationTime('1h').sign(privateKey)
    let finishModels!: (response: Response) => void
    // Deliberately ignore abort in the mock: late responses must still be blocked.
    const exchange = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        access_token: 'test-access', id_token: token,
        expires_in: 3_600, scope: 'chatgpt.tokens.use.direct'
      }))
      .mockImplementationOnce(() =>
        new Promise<Response>((resolve) => {
          finishModels = resolve
        })
      )
    expect((await browserFetch(callback)).status).toBe(200)
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2))
    signIn.cancel()
    await expect(signIn.complete).rejects.toThrow('sign-in ended')
    expect(exchange.mock.calls[1]![1]!.signal!.aborted).toBe(true)

    finishModels(Response.json({ models: [{ slug: 'test-model', visibility: 'list' }] }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(account.save).not.toHaveBeenCalled()
    expect(account.use).not.toHaveBeenCalled()
  })

  it.each([false, true])('validates state, signed identity and PKCE before saving (wrong nonce: %s)', async (wrongNonce) => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    account.publicKey = publicKey
    const signIn = await startChatGPTSignIn()
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    expect(authorize.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(authorize.searchParams.get('agent_name_hint')).toBe('Leon AI')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('resource')).toBe('https://api.openai.com/v1')

    const token = await new SignJWT({ nonce: wrongNonce ? 'wrong' : authorize.searchParams.get('nonce') })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com').setAudience('oaiapp_test')
      .setSubject('test-owner').setExpirationTime('1h').sign(privateKey)
    const exchange = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        access_token: 'test-access', refresh_token: 'test-refresh', id_token: token,
        expires_in: 3_600, scope: 'chatgpt.tokens.use.direct'
      }))
      .mockResolvedValueOnce(Response.json({ models: [{ slug: 'test-model', visibility: 'list' }] }))
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('client_id', 'oaiapp_test')
    callback.searchParams.set('state', 'wrong-state')
    expect((await browserFetch(callback)).status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()

    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    expect((await browserFetch(callback)).status).toBe(200)
    if (wrongNonce) {
      await expect(signIn.complete).rejects.toThrow('finish ChatGPT sign-in')
      expect(account.save).not.toHaveBeenCalled()
      expect(account.use).not.toHaveBeenCalled()
    } else {
      await signIn.complete
      const form = new URLSearchParams(exchange.mock.calls[0]![1]!.body as string)
      expect(form.get('client_id')).toBe('oaiapp_test')
      expect(form.get('code_verifier')).not.toBeNull()
      expect(form.get('redirect_uri')).toBe(authorize.searchParams.get('redirect_uri'))
      expect(account.save).toHaveBeenCalledWith(expect.objectContaining({
        credentials: expect.objectContaining({
          subject: 'test-owner', client_id: 'oaiapp_test', model: 'test-model', auth_kind: 'chatgpt'
        })
      }))
      expect(account.use).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^openai\./), 'test-model')
    }
  })

  it('can reconnect expired credentials but rejects a different client registration', async () => {
    account.get.mockResolvedValueOnce({
      auth_kind: 'chatgpt', client_id: 'oaiapp_saved', subject: 'owner',
      ext_agent_host_id: 'urn:uuid:test', expires_at: 1
    })
    const signIn = await startChatGPTSignIn('openai.saved')
    pending.push(signIn.cancel)
    expect(account.get).toHaveBeenCalledWith('openai.saved', undefined, false, false)
    const authorize = new URL(signIn.url)
    expect(authorize.searchParams.get('client_id')).toBe('oaiapp_saved')
    expect(authorize.searchParams.has('agent_name_hint')).toBe(false)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('client_id', 'oaiapp_other')

    expect((await browserFetch(callback)).status).toBe(400)
    await expect(signIn.complete).rejects.toThrow('sign-in ended')
    expect(account.save).not.toHaveBeenCalled()
  })
})
