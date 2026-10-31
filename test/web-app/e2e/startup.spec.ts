import { test, expect, SESSION_URL, LATEST_ANSWER } from './fixtures'

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
