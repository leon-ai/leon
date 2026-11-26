import type { Route } from '@playwright/test'

import { UpdatePhase, type UpdateSnapshot } from '../../../bridges/runtime/contracts/updates'
import { UPDATE_FIXTURE } from '../../fixtures/updates'
import { test, expect, setFixtureTheme } from './fixtures'

for (const [theme, reducedMotion] of [['dark', 'no-preference'], ['light', 'reduce']] as const) {
  test(`checks once with cloud-arrow feedback and distinguishes up-to-date from failure (${theme})`, async ({ page, ui }) => {
    ui.updates.check!.release = null
    let requested = Promise.withResolvers<Route>()
    await page.route('**/api/v1/updates/check', (route) => requested.resolve(route))
    await page.emulateMedia({ reducedMotion })
    await page.goto('./')
    await setFixtureTheme(page, theme)
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    const route = await requested.promise
    const checking = page.getByRole('button', { name: 'Checking for updates…', exact: true })
    await expect(checking).toBeDisabled()
    await expect(checking).toHaveAttribute('aria-busy', 'true')
    await expect(checking.locator('.icon-part-download')).toHaveCSS('animation-name', reducedMotion === 'reduce' ? 'none' : 'icon-download')
    await expect(checking.locator('.loader')).toHaveCount(0)
    await route.fulfill({ json: ui.updates })
    await expect(page.getByText('I’m already up to date', { exact: true })).toBeVisible()
    await expect(page.getByText(`I’m running v${ui.updates.check!.currentVersion}, with my latest improvements in place.`, { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close notification', exact: true }).click()

    requested = Promise.withResolvers<Route>()
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    await (await requested.promise).fulfill({ status: 503, json: { message: 'Release information is temporarily unavailable.' } })
    await expect(page.getByText('I couldn’t check for updates', { exact: true })).toBeVisible()
    await expect(page.getByText('I’m already up to date', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled()
  })

  test(`shows release metadata, Markdown highlights and categorized changes without applying on cancel (${theme})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto('./')
    await setFixtureTheme(page, theme)
    await page.getByRole('button', { name: 'New update available!', exact: true }).click()
    const release = UPDATE_FIXTURE.check!.release!
    const dialog = page.getByRole('dialog', { name: release.title, exact: true })
    await expect(dialog.getByText(`v${release.version}`, { exact: true })).toBeVisible()
    await expect(dialog.locator('time')).toHaveAttribute('datetime', release.publishedAt)
    await expect(dialog.getByRole('heading', { name: 'A shared home for each project', exact: true })).toBeVisible()
    await expect(dialog.locator('strong').filter({ hasText: 'brief and folders' })).toBeVisible()
    await expect(dialog.locator('.streaming-text-character-new')).toHaveCount(0)
    await dialog.getByText('Full changelog', { exact: true }).click()
    for (const label of ['New', 'Improvements', 'Fixes', 'Removed']) {
      await expect(dialog.getByRole('region', { name: label, exact: true }).getByRole('listitem')).toHaveCount(1)
    }
    await expect(dialog).toHaveCSS('opacity', '1')
    await page.screenshot({ path: testInfo.outputPath(`release-dialog-${theme}.png`) })
    await page.setViewportSize({ width: 390, height: 640 })
    await expect(dialog.getByRole('button', { name: 'Update Leon', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    expect(await dialog.locator('.dialog-body').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`release-dialog-${theme}-narrow.png`) })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(ui.requests.filter((request) => request.pathname.endsWith('/updates/apply'))).toHaveLength(0)
  })
}

for (const outcome of ['completed', 'failed'] as const) {
  test(`reconnects after an accepted update and handles its ${outcome} receipt once`, async ({ page, ui }) => {
    let applications = 0
    let loads = 0
    page.on('load', () => loads++)
    await page.route('**/api/v1/updates/apply', async (route) => {
      applications++
      expect(route.request().postDataJSON()).toEqual({ tag: UPDATE_FIXTURE.check!.release!.tag })
      ui.updates = { check: ui.updates.check, state: {
        id: 'update-receipt', phase: UpdatePhase.Scheduled, version: UPDATE_FIXTURE.check!.release!.version, error: null
      } }
      await route.fulfill({ status: 202, json: ui.updates })
    })
    await page.goto('./')
    await page.getByRole('button', { name: 'New update available!', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: UPDATE_FIXTURE.check!.release!.title, exact: true })
    await dialog.getByRole('button', { name: 'Update Leon', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Updating Leon…', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    const received = ui.updates.state!
    const disconnected = Promise.withResolvers<void>()
    await page.route('**/api/v1/updates', async (route) => {
      await route.fulfill({ status: 503, json: { message: 'Restarting' } })
      disconnected.resolve()
    })
    await disconnected.promise
    await page.unroute('**/api/v1/updates')
    ui.updates = { check: null, state: { ...received,
      phase: outcome === 'completed' ? UpdatePhase.Completed : UpdatePhase.Failed,
      error: outcome === 'failed' ? 'I restored the previous version after the build failed.' : null } }
    if (outcome === 'completed') {
      await expect.poll(() => loads).toBe(2)
      await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible()
    } else {
      await expect(page.getByText('I couldn’t finish updating', { exact: true })).toBeVisible()
      await expect(dialog).toHaveCount(0)
      expect(loads).toBe(1)
    }
    expect(applications).toBe(1)
    await expect(page.getByText('I couldn’t check for updates', { exact: true })).toHaveCount(0)
  })
}

test('keeps release notes readable when installation is unavailable and reports rejected starts', async ({ page, ui }) => {
  ui.updates.check!.canInstall = false
  ui.updates.check!.reason = 'I need your local changes committed before updating.'
  await page.goto('./')
  await page.getByRole('button', { name: 'New update available!', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: UPDATE_FIXTURE.check!.release!.title, exact: true })
  await expect(dialog.getByRole('button', { name: 'Update Leon', exact: true })).toBeDisabled()
  await expect(dialog.getByText(ui.updates.check!.reason, { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  ui.updates = structuredClone(UPDATE_FIXTURE) as UpdateSnapshot
  await page.getByRole('button', { name: 'New update available!', exact: true }).click()
  await dialog.getByRole('button', { name: 'Update Leon', exact: true }).click()
  await expect(page.getByText('I couldn’t start the update', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Update Leon', exact: true })).toBeEnabled()
})

test('updates the desktop independently when the server is already current', async ({ page, ui }) => {
  ui.updates.check!.release = null
  await page.route('**/web-app/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="leon-desktop" content="true"><meta name="leon-desktop-updates" content="true">') })
  })
  const desktop = { supported: true, currentVersion: '0.1.0', version: '0.1.1', phase: 'ready',
    releaseNotes: 'Native improvements.', progress: null, error: null, reason: null }
  await page.route('**/__desktop/updates/state', (route) => route.fulfill({ json: desktop }))
  await page.route('**/__desktop/updates/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(desktop)}\n\n` }))
  await page.route('**/__desktop/updates/check', (route) => route.fulfill({ json: desktop }))
  let installs = 0
  await page.route('**/__desktop/updates/install', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: desktop.version })
    installs++
    await route.fulfill({ status: 202, json: { ...desktop, phase: 'installing' } })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'New update available!', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Update Leon', exact: true })
  await expect(dialog.getByRole('tab')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Update Leon', exact: true }).click()
  await expect.poll(() => installs).toBe(1)
  expect(ui.requests.filter((request) => request.pathname.endsWith('/updates/apply'))).toHaveLength(0)
})

test('keeps a ready desktop update accessible when server update discovery fails', async ({ page }) => {
  await page.route('**/web-app/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="leon-desktop-updates" content="true">') })
  })
  const desktop = { supported: true, currentVersion: '0.1.0', version: '0.1.1', phase: 'ready',
    releaseNotes: 'Native improvements.', progress: null, error: null, reason: null }
  await page.route('**/__desktop/updates/state', (route) => route.fulfill({ json: desktop }))
  await page.route('**/__desktop/updates/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(desktop)}\n\n` }))
  await page.route('**/__desktop/updates/check', (route) => route.fulfill({ json: desktop }))
  await page.route('**/api/v1/updates/check', (route) => route.fulfill({ status: 503, json: { message: 'Release discovery is unavailable.' } }))
  await page.goto('./')
  await page.getByRole('button', { name: 'New update available!', exact: true }).click()
  await expect(page.getByText('I couldn’t check for updates', { exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Update Leon', exact: true })
  await expect(dialog.getByRole('button', { name: 'Update Leon', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('list', { name: 'Server update progress' })).toHaveCount(0)
})

for (const outcome of ['completed', 'failed'] as const) {
  test(`coordinates one update action and permits app replacement only after a ${outcome} server receipt`, async ({ page, ui }) => {
    await page.route('**/web-app/', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="leon-desktop-updates" content="true">') })
    })
    const native = { supported: true, currentVersion: '0.1.0', version: '0.1.1', phase: 'ready',
      releaseNotes: 'Native improvements.', progress: null, error: null, reason: null }
    await page.route('**/__desktop/updates/state', (route) => route.fulfill({ json: native }))
    await page.route('**/__desktop/updates/events', (route) => route.fulfill({
      contentType: 'text/event-stream', body: `data: ${JSON.stringify(native)}\n\n`
    }))
    await page.route('**/__desktop/updates/check', (route) => route.fulfill({ json: native }))
    let installs = 0
    let applications = 0
    await page.route('**/__desktop/updates/install', async (route) => {
      installs++
      expect(route.request().postDataJSON()).toEqual({ version: native.version })
      await route.fulfill({ status: 202, json: { ...native, phase: 'installing' } })
    })
    await page.route('**/api/v1/updates/apply', async (route) => {
      applications++
      ui.updates.state = { id: 'coordinated-update', phase: UpdatePhase.Installing,
        version: ui.updates.check!.release!.version, error: null }
      await route.fulfill({ status: 202, json: ui.updates })
    })
    await page.goto('./')
    await page.getByRole('button', { name: 'New update available!', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    const before = ui.requests.filter(({ pathname }) => pathname.endsWith('/updates')).length
    await dialog.getByRole('button', { name: 'Update Leon', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Updating Leon…', exact: true })).toBeDisabled()
    await expect.poll(() => ui.requests.filter(({ pathname }) => pathname.endsWith('/updates')).length).toBeGreaterThan(before)
    expect(installs).toBe(0)
    ui.updates.state = { ...ui.updates.state!, phase: outcome === 'completed' ? UpdatePhase.Completed : UpdatePhase.Failed,
      error: outcome === 'failed' ? 'My previous server version was restored.' : null }
    if (outcome === 'completed') {
      await expect.poll(() => installs).toBe(1)
    } else {
      await expect(page.getByText('I couldn’t finish updating', { exact: true })).toBeVisible()
      expect(installs).toBe(0)
    }
    expect(applications).toBe(1)
  })
}

test('confirms leaving during server installation without cancelling or repeating the accepted update', async ({ page, ui }) => {
  let applications = 0
  await page.route('**/api/v1/updates/apply', async (route) => {
    applications++
    ui.updates.state = { id: 'background-update', phase: UpdatePhase.Installing,
      version: ui.updates.check!.release!.version, error: null }
    await route.fulfill({ status: 202, json: ui.updates })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'New update available!', exact: true }).click()
  await page.getByRole('button', { name: 'Update Leon', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Updating Leon…', exact: true })).toBeDisabled()

  const confirmation = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  const prompt = await confirmation
  expect(prompt.type()).toBe('beforeunload')
  await prompt.dismiss()
  expect(page.isClosed()).toBe(false)
  await expect(page.getByRole('button', { name: 'Updating Leon…', exact: true })).toBeVisible()
  expect(applications).toBe(1)

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload')
    await dialog.accept()
  })
  const closed = page.waitForEvent('close')
  await page.close({ runBeforeUnload: true })
  await closed
  expect(applications).toBe(1)
  expect(ui.updates.state?.phase).toBe(UpdatePhase.Installing)
})
