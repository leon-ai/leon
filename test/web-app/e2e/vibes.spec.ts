import { test, expect, SESSION_URL } from './fixtures'

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
