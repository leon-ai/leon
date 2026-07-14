import { describe, expect, it, vi } from 'vitest'

import {
  setInitStatus,
  subscribeInitStatuses
} from '../../../app/src/js/init-status'

describe('web app initialization status', () => {
  it('reconciles statuses published before the UI subscribes', () => {
    const listener = vi.fn()

    setInitStatus('clientCoreServerHandshake', 'success')
    const unsubscribe = subscribeInitStatuses(listener)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ clientCoreServerHandshake: 'success' })
    )

    unsubscribe()
  })
})
