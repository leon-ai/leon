import { test, expect, SESSION_URL } from './fixtures'

test('keeps session title motion idle during scrolling and resumes on pointer intent', async ({ page, ui }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (let index = 3; index < 120; index++) {
    const session = {
      ...ui.sessions[0]!, id: `scroll-session-${index}`,
      title: `A longer saved conversation about design and rendering ${index}`
    }
    ui.sessions.push(session)
    ui.history.set(session.id, [])
  }
  await page.goto(SESSION_URL)
  const sidebar = page.locator('.sidebar-scroll-area')
  await sidebar.hover({ position: { x: 100, y: 300 } })
  for (let index = 0; index < 6; index++) {
    const previous = await sidebar.evaluate((element) => element.scrollTop)
    await page.mouse.wheel(0, 120)
    await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(previous)
    await expect(sidebar.locator('.session-list-item-title-scrolling')).toHaveCount(0)
  }
  const link = sidebar.getByRole('link').nth(8)
  // Repeated hover allows native scroll settling without inspecting virtualizer state.
  await expect(async () => {
    await link.hover()
    await expect(link.locator('.session-list-item-title')).toHaveClass(/session-list-item-title-scrolling/, { timeout: 1_000 })
  }).toPass()
  await page.mouse.wheel(0, 30)
  await expect(sidebar.locator('.session-list-item-title-scrolling')).toHaveCount(0)
})
