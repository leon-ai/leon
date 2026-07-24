import { describe, expect, it } from 'vitest'

import { parseProfileCredential } from '@/core/profile-auth'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'

describe('profile runtime', () => {
  it('parses the public profile credential shape', () => {
    expect(parseProfileCredential('louis:505984bf')).toEqual({
      profileName: 'louis',
      secret: '505984bf',
      value: 'louis:505984bf'
    })
    expect(parseProfileCredential('missing-prefix')).toBeNull()
    expect(parseProfileCredential('../louis:505984bf')).toBeNull()
  })

  it('rejects unsafe profile path segments', () => {
    expect(isValidProfileName('just-me')).toBe(true)
    expect(isValidProfileName('nested/profile')).toBe(false)
    expect(isValidProfileName('nested\\profile')).toBe(false)
    expect(isValidProfileName('profile:token')).toBe(false)
  })

  it('keeps concurrent asynchronous profile contexts isolated', async () => {
    const observedProfiles = await Promise.all(
      ['louis', 'just-me'].map((profileName) =>
        runWithProfileContext({ profileName }, async () => {
          await Promise.resolve()
          return getActiveProfileName()
        })
      )
    )

    expect(observedProfiles).toEqual(['louis', 'just-me'])
  })

  it('lazily creates one service per profile', () => {
    let instanceCount = 0
    const service = createProfileServiceProxy('profile-runtime-test', () => ({
      id: ++instanceCount
    }))
    const firstProfileId = runWithProfileContext(
      { profileName: 'profile-a' },
      () => service.id
    )
    const secondProfileId = runWithProfileContext(
      { profileName: 'profile-b' },
      () => service.id
    )
    const repeatedFirstProfileId = runWithProfileContext(
      { profileName: 'profile-a' },
      () => service.id
    )

    expect(firstProfileId).not.toBe(secondProfileId)
    expect(repeatedFirstProfileId).toBe(firstProfileId)
  })
})
