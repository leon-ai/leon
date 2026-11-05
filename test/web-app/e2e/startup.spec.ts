import { test, expect, SESSION_URL, LATEST_ANSWER, finishFiniteAnimations } from './fixtures'

for (const { theme, reducedMotion, width } of [
  { theme: 'dark', reducedMotion: 'no-preference', width: 1_512 },
  { theme: 'light', reducedMotion: 'reduce', width: 390 }
] as const) {
  test(`keeps unknown pages cozy and provides a keyboard route home (${theme})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto('a-quiet-detour/unknown-page')
    const pageContent = page.getByRole('region', { name: 'A little detour.', exact: true })
    await expect(pageContent).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    }
    await page.setViewportSize({ width, height: 982 })
    await expect(pageContent.getByRole('heading', { level: 1 })).toHaveText('A little detour.')
    await expect(pageContent.getByRole('img', { name: '404: Page not found', exact: true })).toBeVisible()
    await expect(pageContent.locator('p')).toHaveText('I couldn’t find this page. Let’s head back and make something.')
    await expect(pageContent.locator('.not-found-page-logo')).toHaveCSS(
      'background-image', new RegExp(`logo-for-${theme === 'light' ? 'light' : 'dark'}-bg\\.svg`)
    )
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveCount(0)
    await expect(page.locator('.toast')).toHaveCount(0)
    expect(ui.historyRequests).toHaveLength(0)
    const composition = pageContent.locator('.not-found-page-content')
    await expect(composition).toHaveCSS('animation-name', reducedMotion === 'reduce' ? 'none' : 'not-found-enter')
    await finishFiniteAnimations(pageContent)
    const bounds = (await composition.boundingBox())!
    const main = (await page.getByRole('main').boundingBox())!
    expect(Math.abs(bounds.x + bounds.width / 2 - main.x - main.width / 2)).toBeLessThan(1)
    expect(Math.abs(bounds.y + bounds.height / 2 - main.y - main.height / 2)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const screenshot = testInfo.outputPath(`not-found-${theme}.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach(`not-found-${theme}`, { path: screenshot, contentType: 'image/png' })
    const home = pageContent.getByRole('link', { name: 'Back home', exact: true })
    await expect(home).toHaveAttribute('href', '/web-app/')
    await home.focus()
    await home.press('Enter')
    await expect(page).toHaveURL(/\/web-app\/$/)
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    await expect(pageContent).toHaveCount(0)
  })
}

test('renders the frame and editable composer during slow authentication without private requests', async ({ page, ui }) => {
  const releaseAuth = ui.holdAuthentication()
  const releaseHistory = ui.holdHistory()
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
  await expect(composer).toBeFocused()
  await composer.fill('Draft before authentication')
  await expect(page.getByText('Connecting to Leon…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
  expect(ui.requests.every((url) => url.pathname.endsWith('/profile-auth'))).toBe(true)
  releaseAuth()
  // Metadata requests need not wait for the held history request.
  await expect(page.getByRole('group', { name: 'Model and reasoning settings' })).toContainText('GPT-6.1 Sol')
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })).toBeVisible()
  expect(ui.historyRequests).toHaveLength(1)
  releaseHistory()
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Draft before authentication')
  await expect(composer).toBeFocused()
  expect(ui.completedRequests.filter((url) => url.pathname.endsWith('/profile-auth'))).toHaveLength(1)
})

test('uses the hosted bootstrap without a separate authentication request', async ({ page, ui }) => {
  await page.setExtraHTTPHeaders({ 'x-ui-bootstrap': 'authenticated' })
  ui.failure = { path: '/api/v1/profile-auth', status: 500, message: 'Unexpected auth probe.' }
  const response = await page.goto(SESSION_URL)
  expect(response?.headers()['cache-control']).toBe('private, no-store')
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
  expect(ui.requests.some((url) => url.pathname.endsWith('/profile-auth'))).toBe(false)
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('uses signed-out bootstrap for login without fetching any private data', async ({ page, ui }) => {
  await page.setExtraHTTPHeaders({ 'x-ui-bootstrap': 'signed-out' })
  ui.authenticated = false
  await page.goto('./')
  await expect(page.getByRole('form', { name: 'Connect to Leon' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveCount(0)
  expect(ui.requests).toHaveLength(0)
  await page.getByLabel('Profile token').fill('fixture-token')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })).toBeVisible()
})

test('shows login for expired credentials without exposing session content', async ({ page, ui }) => {
  ui.authenticated = false
  await page.goto(SESSION_URL)
  await expect(page.getByRole('form', { name: 'Connect to Leon' })).toBeVisible()
  expect(ui.requests.every((url) => url.pathname.endsWith('/profile-auth'))).toBe(true)
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
})

test('keeps startup drafts through an authentication error and explicit retry', async ({ page, ui }) => {
  ui.failure = { path: '/api/v1/profile-auth', status: 503, message: 'Auth temporarily unavailable.' }
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep my startup draft')
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible()
  ui.failure = undefined
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Keep my startup draft')
})
