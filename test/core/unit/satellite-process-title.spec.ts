import { describe, expect, it } from 'vitest'

import { buildSatelliteProcessTitle } from '@/core/satellite/satellite-process-title'

const MAXIMUM_PROCESS_TITLE_LENGTH = 48

describe('Satellite process title', () => {
  it('identifies the profile and device with portable characters', () => {
    expect(
      buildSatelliteProcessTitle('Work Profile', 'Louis\'s MacBook / Pro')
    ).toBe('leon-satellite-work-profile-louis-s-macbook')
  })

  it('bounds long profile and device names', () => {
    const title = buildSatelliteProcessTitle(
      'a-very-long-profile-name',
      'a-very-long-device-identifier'
    )

    expect(title.length).toBeLessThanOrEqual(MAXIMUM_PROCESS_TITLE_LENGTH)
    expect(title).toBe('leon-satellite-a-very-long-prof-a-very-long-devi')
  })
})
