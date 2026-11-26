import { test, expect, LATEST_ANSWER, SESSION_ID, SESSION_URL } from './fixtures'

test('reveals the owner message when the new turn’s smooth scroll is interrupted', async ({ page, ui }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  ui.history.set(SESSION_ID, ui.history.get(SESSION_ID)!.slice(-2))
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages`, (route) => {
    const input = route.request().postDataJSON() as { id: string }

    return route.fulfill({ json: { command: { id: input.id, status: 'accepted' } } })
  })
  await page.goto(SESSION_URL)
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeInViewport()

  const feedViewport = page.locator('.app-main')
  await feedViewport.evaluate((element) => {
    // Cancel the smooth scroll before it can move or emit scroll events.
    element.scrollTo = new Proxy(element.scrollTo, {
      apply(scrollTo, target, args): void {
        Reflect.apply(scrollTo, target, args)
        if (args[0]?.behavior === 'smooth') {
          Reflect.apply(scrollTo, target, [{ top: element.scrollTop, behavior: 'instant' }])
        }
      }
    })
  })

  const text = 'Keep the next question in view.'
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill(text)
  await composer.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop this turn' })).toBeVisible()

  const owner = page.getByText(text, { exact: true })
  await expect(owner).toBeInViewport()
  await expect(owner).toHaveCSS('opacity', '1')
})

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
