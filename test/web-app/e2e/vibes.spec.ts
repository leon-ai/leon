import { test, expect, SESSION_URL } from './fixtures'

test.describe('ambient recovery', () => {
  test.use({ timezoneId: 'UTC' })

  for (const [time, initialPhase, nextPhase, nextSeason] of [
    ['2026-11-15T16:59:00Z', 'afternoon', 'sunset', 'autumn'],
    ['2026-11-30T23:59:00Z', 'night', 'night', 'winter']
  ] as const) {
    test(`keeps local scenery current without ambient data at ${time}`, async ({ page, ui }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.clock.install({ time: new Date(time) })
      ui.failure = { path: '/api/v1/ambient', status: 503, message: 'Temporary ambient failure' }
      await page.goto(SESSION_URL)
      const scene = page.locator('.vibes-frame-active')
      await expect(scene).toHaveAttribute('data-vibe-scene', `autumn-clear-${initialPhase}`)
      await expect(page.getByText('Could not load ambient conditions', { exact: true })).toBeVisible()
      await page.clock.fastForward(60_000)
      await expect(scene).toHaveAttribute('data-vibe-scene', `${nextSeason}-clear-${nextPhase}`)
    })
  }

  test('replaces local scenery when the ambient service recovers', async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install({ time: new Date('2026-11-15T23:00:00Z') })
    ui.failure = { path: '/api/v1/ambient', status: 503, message: 'Temporary ambient failure' }
    await page.goto(SESSION_URL)
    const scene = page.locator('.vibes-frame-active')
    await expect(scene).toHaveAttribute('data-vibe-scene', 'autumn-clear-night')
    await expect(page.getByText('Could not load ambient conditions', { exact: true })).toBeVisible()
    ui.failure = undefined
    await page.clock.fastForward(60_000)
    await expect(scene).toHaveAttribute('data-vibe-scene', 'autumn-clear-afternoon')
  })

  test('replaces stale cached conditions with local scenery after a refresh failure', async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install({ time: new Date('2026-11-15T00:00:00Z') })
    ui.ambient = { ...ui.ambient, solarPhase: 'night' }
    await page.goto(SESSION_URL)
    const scene = page.locator('.vibes-frame-active')
    await expect(scene).toHaveAttribute('data-vibe-scene', 'autumn-clear-night')
    ui.failure = { path: '/api/v1/ambient', status: 503, message: 'Temporary ambient failure' }
    await page.clock.fastForward(15 * 60 * 60 * 1_000)
    await expect(scene).toHaveAttribute('data-vibe-scene', 'autumn-clear-afternoon')
  })

  test('retries failed artwork without navigation or another ambient update', async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install({ time: new Date('2026-11-15T12:00:00Z') })
    await page.addInitScript(() => localStorage.setItem('leon.web-app.theme', 'dark'))
    ui.ambient = { ...ui.ambient, season: 'winter', solarPhase: 'sunset' }
    let requests = 0
    await page.route('**/winter/clear/sunset.webp', async (route) => {
      requests += 1
      if (requests === 1) {
        await route.fulfill({ status: 503, body: '' })
      } else {
        await route.continue()
      }
    })
    await page.goto(SESSION_URL)
    await expect.poll(() => requests).toBe(1)
    const scene = page.locator('.vibes-frame-active')
    await expect(scene).toHaveAttribute('data-vibe-scene', 'autumn-clear-noon')
    await page.clock.fastForward(5_000)
    await expect(scene).toHaveAttribute('data-vibe-scene', 'winter-clear-sunset')
    expect(requests).toBe(2)
  })
})

test('uses the ambient season, solar phase and weather in the production scene', async ({ page, ui }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  ui.ambient = {
    season: 'winter', solarPhase: 'sunset', timeZone: 'Europe/Paris',
    weather: {
      condition: 'snow', description: 'Snow', temperatureC: -2, feelsLikeC: -4,
      weatherCode: 73, location: 'Test location', observationTime: '2026-12-20T16:00', fetchedAt: Date.now()
    }
  }
  await page.goto(SESSION_URL)
  const scene = page.locator('.vibes-frame-active')
  await expect(scene).toHaveAttribute('data-season', 'winter')
  await expect(scene).toHaveClass(/vibes-solar-sunset/)
  await expect(scene).toHaveClass(/vibes-weather-snow/)
  await expect(scene.locator('canvas.weather-layer')).toHaveCount(1)
})

for (const mood of ['default', 'tired', 'sad', 'angry', 'cocky'] as const) {
  test(`shows the profile’s ${mood} mood with its existing sidebar artwork`, async ({ page, ui }) => {
    ui.ambient.mood = mood
    await page.goto(SESSION_URL)
    const display = mood === 'default' ? 'happy' : mood
    const label = `${display.charAt(0).toUpperCase()}${display.slice(1)} mood`
    const icon = page.getByRole('img', { name: label, exact: true })
    await expect(icon).toBeVisible()
    await expect(icon.locator('.sidebar-footer-mood-icon')).toHaveAttribute('style', `--sidebar-footer-mood-icon: url("/web-app/img/moods/${display}.svg");`)
  })
}

test('updates the sidebar mood through the existing session stream without navigation', async ({ page, ui }) => {
  ui.ambient.mood = 'tired'
  const gate = Promise.withResolvers<void>()
  await page.route('**/api/v1/sessions/events?*', async (route) => {
    await gate.promise
    ui.ambient.mood = 'angry'
    const event = {
      type: 'mood_changed', sequence: 1, session_id: '', turn_id: null, response_id: null,
      created_at: Date.now(), data: { mood: { type: 'angry' } }
    }
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(event)}\n\n` })
  })
  try {
    await page.goto(SESSION_URL)
    await expect(page.getByRole('img', { name: 'Tired mood', exact: true })).toBeVisible()
    gate.resolve()
    await expect(page.getByRole('img', { name: 'Angry mood', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Tired mood', exact: true })).toHaveCount(0)
  } finally {
    gate.resolve()
  }
})
