import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosMocks = vi.hoisted(() => ({
  axios: {
    defaults: { withCredentials: false },
    get: vi.fn(),
    post: vi.fn()
  }
}))

vi.mock('axios', () => ({ default: axiosMocks.axios }))

import { ensureProfileAuthentication } from '../../../app/src/js/profile-auth'

describe('web app profile authentication', () => {
  beforeEach(() => {
    axiosMocks.axios.defaults.withCredentials = false
    axiosMocks.axios.get.mockReset()
    axiosMocks.axios.post.mockReset()
  })

  it('continues when the profile cookie is authenticated', async () => {
    axiosMocks.axios.get.mockResolvedValue({
      data: { authenticated: true }
    })

    await ensureProfileAuthentication('http://localhost:5366')

    expect(axiosMocks.axios.defaults.withCredentials).toBe(true)
    expect(axiosMocks.axios.post).not.toHaveBeenCalled()
  })
})
