import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startOpenRouterSignIn } from '@/core/llm-manager/llm-accounts/llm-account-openrouter'

const account = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), use: vi.fn() }))
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  MODEL_ACCOUNT_STORE: { getCredentials: account.get, save: account.save },
  useModelAccount: account.use
}))
vi.mock('@/core/profile-runtime/profile-context', () => ({
  getActiveProfileName: (): string => 'test-owner',
  runWithProfileContext: async (_context: unknown, run: () => Promise<unknown>): Promise<unknown> => run()
}))

const browserFetch = globalThis.fetch
const pending: (() => void)[] = []

beforeEach(() => {
  account.get.mockResolvedValue(null)
  account.save.mockImplementation(async (input) => input)
})
afterEach(() => {
  pending.splice(0).forEach((cancel) => cancel())
  vi.restoreAllMocks()
})

describe('OpenRouter account sign-in', () => {
  it.each([true, false])('checks state and PKCE before saving a dedicated key (accepted: %s)', async (accepted) => {
    const signIn = await startOpenRouterSignIn(undefined, 'anthropic/test-model')
    pending.push(signIn.cancel)
    const authorize = new URL(signIn.url)
    const callback = new URL(authorize.searchParams.get('callback_url')!)
    expect(authorize.origin).toBe('https://openrouter.ai')
    expect(authorize.pathname).toBe('/auth')
    expect(authorize.searchParams.get('key_label')).toBe('Leon AI')
    const exchange = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json(accepted ? { key: 'private-router-key' } : {}, { status: accepted ? 200 : 401 })
    )
    callback.searchParams.set('code', 'test-code')
    callback.searchParams.set('state', 'wrong-state')
    expect((await browserFetch(callback)).status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()
    expect(account.save).not.toHaveBeenCalled()

    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    expect((await browserFetch(callback)).status).toBe(200)
    if (accepted) {
      await signIn.complete
      const body = JSON.parse(exchange.mock.calls[0]![1]!.body as string)
      expect(exchange.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/auth/keys')
      expect(body.code).toBe('test-code')
      expect(body.code_challenge_method).toBe('S256')
      expect(createHash('sha256').update(body.code_verifier).digest('base64url'))
        .toBe(authorize.searchParams.get('code_challenge'))
      expect(account.save).toHaveBeenCalledWith(expect.objectContaining({
        auth_type: 'api_key', credentials: {
          auth_kind: 'openrouter', api_key: 'private-router-key', model: 'anthropic/test-model'
        }
      }))
      expect(account.use).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^openrouter\./), 'anthropic/test-model')
      expect(signIn.url).not.toContain('private-router-key')
    } else {
      await expect(signIn.complete).rejects.toThrow('finish OpenRouter sign-in')
      expect(account.save).not.toHaveBeenCalled()
      expect(account.use).not.toHaveBeenCalled()
    }
  })

  it('cancels the listener without exchanging credentials', async () => {
    const signIn = await startOpenRouterSignIn()
    const exchange = vi.spyOn(globalThis, 'fetch')
    signIn.cancel()
    await expect(signIn.complete).rejects.toThrow('sign-in ended')
    expect(exchange).not.toHaveBeenCalled()
    expect(account.save).not.toHaveBeenCalled()
  })
})
