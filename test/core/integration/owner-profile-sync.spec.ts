import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  buildOwnerDocument, getOwnerContextPath, getOwnerProfilePath,
  normalizeOwnerProfile, readOwnerProfileSync, writeOwnerProfile
} from '@/core/context-manager/owner-profile'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import { LogHelper } from '@/helpers/log-helper'

const fixture = vi.hoisted(() => ({ root: '', prompt: vi.fn() }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({ getProfilePaths: (): { context: string } => ({ context: fixture.root }) }))
vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): { time_zone: string } => ({ time_zone: 'UTC' }) } }))
vi.mock('@/core', () => ({
  LLM_PROVIDER: { prompt: fixture.prompt },
  CONTEXT_MANAGER: { refreshOwnerContext: vi.fn() }, PERSONA: { refreshContextInfo: vi.fn() }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn() }
}))

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-owner-sync-'))
  fixture.prompt.mockReset()
  const profile = normalizeOwnerProfile({ owner_first_name: 'Mira', identity: ['First name: Mira.'] })
  await writeOwnerProfile(profile)
  await fs.writeFile(getOwnerContextPath(), buildOwnerDocument(profile))
})
afterEach(async () => {
  await fs.rm(fixture.root, { recursive: true, force: true })
})

it.each([
  { safe: false, missingFacts: ['Unsupported owner identity.'] },
  { safe: true, missingFacts: ['Wrong subject.'] },
  { invalid: true }
])('preserves both canonical artifacts when verification rejects or cannot validate a revision: %j', async (verification) => {
  const paths = [getOwnerContextPath(), getOwnerProfilePath()]
  const before = await Promise.all(paths.map((file) => fs.readFile(file, 'utf8')))
  const revision = normalizeOwnerProfile({ identity: ['First name: Leon.'] })
  fixture.prompt.mockResolvedValueOnce({ output: buildOwnerDocument(revision) })
    .mockResolvedValueOnce({ output: verification })

  const result = await syncOwnerProfileFromTurn('Hello, Leon!', 'I am Leon, your assistant.')

  expect(result.outcome).toBe(verification.safe === undefined ? 'failed' : 'rejected')
  expect(LogHelper.error).toHaveBeenCalledTimes(verification.safe === undefined ? 1 : 0)
  expect(await Promise.all(paths.map((file) => fs.readFile(file, 'utf8')))).toEqual(before)
})

it('accepts an explicit owner name correction even when the owner shares the assistant name', async () => {
  const revision = normalizeOwnerProfile({ owner_first_name: 'Leon', identity: ['First name: Leon.'] })
  fixture.prompt.mockResolvedValueOnce({ output: buildOwnerDocument(revision) })
    .mockResolvedValueOnce({ output: {
      safe: true, missingFacts: []
    } })
    .mockResolvedValueOnce({ output: revision })

  expect((await syncOwnerProfileFromTurn('My name is Leon.', 'Understood.')).outcome).toBe('completed')
  expect(await fs.readFile(getOwnerContextPath(), 'utf8')).toContain('First name: Leon.')
  expect(JSON.parse(await fs.readFile(getOwnerProfilePath(), 'utf8')).owner_first_name).toBe('Leon')
  expect(readOwnerProfileSync().owner_first_name).toBe('Leon')
})

it('allows verified curation of existing facts without requiring a fresh owner disclosure', async () => {
  const revision = normalizeOwnerProfile({ owner_first_name: 'Mira', identity: ['Name: Mira.'] })
  fixture.prompt.mockResolvedValueOnce({ output: buildOwnerDocument(revision) })
    .mockResolvedValueOnce({ output: {
      safe: true, missingFacts: []
    } })
    .mockResolvedValueOnce({ output: revision })

  expect((await syncOwnerProfileFromTurn('Thanks.', 'You are welcome.')).outcome).toBe('completed')
  expect(readOwnerProfileSync().identity).toEqual(['Name: Mira.'])
})
