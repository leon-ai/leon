import { WorkspaceResourceKind } from '../../../bridges/runtime/contracts/workspace'

import type { Page } from '@playwright/test'

import { test, expect, SESSION_ID, SESSION_URL, finishFiniteAnimations } from './fixtures'

async function mockFolders(page: Page): Promise<void> {
  const home = '/home/owner/'
  const folders: Record<string, string[]> = {
    '/': ['home'], '/home/': ['owner'], [home]: ['Projects'], [`${home}Projects/`]: ['Leon', 'Notes'],
    [`${home}Projects/Leon/`]: [], [`${home}Projects/Notes/`]: []
  }
  await page.route('**/api/v1/file-system/list', async (route) => {
    const input = route.request().postDataJSON() as { value: string, folders_only: boolean }
    expect(input.folders_only).toBe(true)
    const directory = input.value === '~/' ? home : input.value
    const names = folders[directory]
    await route.fulfill({ json: { success: Boolean(names), directory,
      parent: directory === '/' ? '/' : directory.slice(0, directory.slice(0, -1).lastIndexOf('/') + 1),
      entries: (names ?? []).map((name) => ({ name, type: 'folder', absolutePath: `${directory}${name}/` })) } })
  })
}

for (const { theme, motion, width } of [
  { theme: 'dark', motion: 'no-preference', width: 1_512 },
  { theme: 'light', motion: 'reduce', width: 1_100 }
] as const) {
  test(`creates contextual workspaces, groups conversations and keeps standalone sessions (${theme})`, async ({ page, ui }, testInfo) => {
    await page.setViewportSize({ width, height: 982 })
    await page.emulateMedia({ reducedMotion: motion })
    await page.addInitScript((value) => localStorage.setItem('leon.web-app.theme', value), theme)
    await mockFolders(page)
    await page.goto('./')
    const sidebar = page.locator('.sidebar')
    const update = sidebar.getByRole('button', { name: 'New update available!', exact: true })
    await expect(update).toHaveText('New')
    await update.hover()
    await expect(page.getByRole('tooltip')).toHaveText('New update available!')
    const updateColor = await update.locator('.app-icon').evaluate((icon) => getComputedStyle(icon).color)
    await expect(update.locator('.button-label')).toHaveCSS('color', updateColor)
    const positions = await sidebar.locator('.sidebar-header').evaluate((header) => {
      const cloud = header.querySelector('.sidebar-update-button .app-icon')!.getBoundingClientRect()
      const close = header.querySelector('.sidebar-controls > .tooltip:last-child .app-icon')!.getBoundingClientRect()
      const logo = header.querySelector('.sidebar-logo-slot')!.getBoundingClientRect()
      const label = header.querySelector('.sidebar-update-button .button-label')!.getBoundingClientRect()

      return { cloudY: cloud.y + cloud.height / 2, closeY: close.y + close.height / 2,
        logoY: logo.y + logo.height / 2, cloudRight: cloud.right, labelLeft: label.left,
        labelY: label.y + label.height / 2 }
    })
    expect(Math.abs(positions.cloudY - positions.closeY)).toBeLessThanOrEqual(1)
    expect(Math.abs(positions.cloudY - positions.logoY)).toBeLessThanOrEqual(1)
    expect(Math.abs(positions.cloudY - positions.labelY)).toBeLessThanOrEqual(1)
    expect(positions.labelLeft).toBeGreaterThan(positions.cloudRight)
    await expect(sidebar.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Docs', exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole('button', { name: 'Mute sounds', exact: true })).toHaveCount(0)
    const closeColor = await sidebar.getByRole('button', { name: 'Close sidebar', exact: true }).evaluate((element) => getComputedStyle(element).color)
    await sidebar.locator('.session-list-heading').hover()
    for (const name of ['New workspace', 'New session']) {
      const button = sidebar.getByRole('button', { name, exact: true })
      await expect(button).toHaveCSS('color', closeColor)
      await button.hover()
      expect(await button.locator('svg').evaluate((element) => [...element.querySelectorAll('*')].every((part) => getComputedStyle(part).animationName === 'none'))).toBe(true)
    }
    await sidebar.getByRole('button', { name: 'New workspace', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'New workspace', exact: true })
    await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Leon')
    await editor.getByRole('textbox', { name: 'Workspace brief' }).fill('I am building my open-source AI assistant.')
    await editor.getByRole('button', { name: 'Leon pink', exact: true }).click()
    const folder = editor.getByRole('textbox', { name: 'Folder', exact: true })
    await folder.click()
    const browser = page.getByRole('dialog', { name: 'Folder', exact: true })
    await browser.getByRole('button', { name: 'Projects', exact: true }).click()
    await browser.getByRole('button', { name: 'Leon', exact: true }).click()
    await browser.getByRole('button', { name: 'Attach this folder', exact: true }).click()
    await expect(browser).toBeHidden()
    await expect(folder).toHaveValue('/home/owner/Projects/Leon/')
    await expect(editor.getByRole('button', { name: /^Remove folder / })).toHaveCount(0)
    await folder.click()
    await browser.getByRole('button', { name: '..', exact: true }).click()
    await browser.getByRole('button', { name: 'Notes', exact: true }).click()
    await browser.getByRole('button', { name: 'Attach this folder', exact: true }).click()
    await editor.getByRole('button', { name: 'Save workspace', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect.poll(() => ui.workspaces.length).toBe(1)
    expect(ui.workspaces[0]).toMatchObject({ name: 'Leon', color: 'pink', resources: [{ location: '/home/owner/Projects/Leon/' }, { location: '/home/owner/Projects/Notes/' }] })
    const expand = sidebar.getByRole('button', { name: 'Expand Leon', exact: true })
    await expect(expand).toBeVisible()
    await expect(expand.locator('animate').first()).not.toHaveAttribute('from', /.+/)
    await page.getByRole('button', { name: 'Attach workspace', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Leon', exact: true }).click()
    await expect(page).toHaveURL(/workspace=/)
    await page.getByRole('textbox', { name: 'Message Leon', exact: true }).fill('Help me build Leon')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect(page).toHaveURL(/session\//)
    const created = ui.sessions.find((session) => session.workspaceId === ui.workspaces[0]!.id)!
    expect(created).toBeDefined()
    await expect(sidebar.locator(`a[data-session-id="${created.id}"]`)).toHaveCount(0)
    await expand.click()
    const collapse = sidebar.getByRole('button', { name: 'Collapse Leon', exact: true })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(sidebar.locator(`a[data-session-id="${created.id}"]`)).toBeVisible()
    await expect(sidebar.locator(`a[data-session-id="${SESSION_ID}"]`)).toBeVisible()
    await collapse.click()
    await expect(sidebar.locator(`a[data-session-id="${created.id}"]`)).toHaveCount(0)
    await expand.click()
    await page.reload()
    await expect(collapse).toBeVisible()
    await expect(sidebar.locator(`a[data-session-id="${created.id}"]`)).toBeVisible()
    await sidebar.screenshot({ path: testInfo.outputPath(`sidebar-workspace-${theme}.png`) })
    await sidebar.locator('.workspace-row').hover()
    await sidebar.getByRole('button', { name: 'Leon options', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit workspace', exact: true })
    await expect(edit.getByRole('textbox', { name: 'Workspace brief' })).toHaveValue('I am building my open-source AI assistant.')
    if (theme === 'light') {
      await page.setViewportSize({ width: 390, height: 982 })
    }
    await finishFiniteAnimations(edit)
    await page.screenshot({ path: testInfo.outputPath(`workspace-${theme}.png`) })
    await page.setViewportSize({ width, height: 982 })
    await edit.getByRole('button', { name: 'Remove workspace', exact: true }).click()
    await page.getByRole('dialog', { name: 'Remove workspace?', exact: true }).getByRole('button', { name: 'Remove workspace', exact: true }).click()
    await expect(sidebar.getByRole('button', { name: 'Collapse Leon', exact: true })).toHaveCount(0)
    await expect(sidebar.locator(`a[data-session-id="${created.id}"]`)).toBeVisible()
    expect(ui.sessions.find((session) => session.id === created.id)).not.toHaveProperty('workspaceId')
    await sidebar.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('link', { name: 'Appearance', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mute sounds', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Violet', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  })
}

test('plays only live turn completion and keeps routine actions, replay and muted events silent', async ({ page, ui }) => {
  await page.addInitScript(() => {
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (): AudioBufferSourceNode {
      const target = window as Window & { soundNotes?: number }
      target.soundNotes = (target.soundNotes ?? 0) + 1
      return create.call(this)
    }
  })
  ui.workspaces.push({ id: '10000000-0000-4000-8000-000000000000', name: 'Hearthlight', brief: 'Films', color: 'amber', resources: [], createdAt: 1, updatedAt: 1 })
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages`, async (route) => {
    const input = route.request().postDataJSON() as { id: string }
    await route.fulfill({ json: { command: { id: input.id, session_id: SESSION_ID, status: 'accepted' } } })
  })
  await page.goto(SESSION_URL)
  await page.getByRole('textbox', { name: 'Message Leon' }).click()
  const count = (): Promise<number> => page.evaluate(() => (window as Window & { soundNotes?: number }).soundNotes ?? 0)
  await page.getByRole('button', { name: 'Expand Hearthlight', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse Hearthlight', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('A quiet message')
  const accepted = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/sessions/${SESSION_ID}/messages`)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await accepted
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveValue('')
  expect(await count()).toBe(0)
  const completed = { sequence: 10, type: 'turn_status' as const, session_id: SESSION_ID, turn_id: 'turn', response_id: 'answer',
    created_at: 1, data: { status: 'completed' } }
  await ui.emit([completed])
  await expect.poll(count).toBe(1)
  await ui.emit([completed])
  await expect.poll(count).toBe(1)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Mute sounds', exact: true }).click()
  await ui.emit([{ ...completed, sequence: 11 }])
  await expect(page.getByRole('button', { name: 'Unmute sounds', exact: true })).toBeVisible()
  expect(await count()).toBe(1)
})

test('searches colored workspaces and creates an attached workspace from the composer', async ({ page, ui }) => {
  ui.workspaces.push(...Array.from({ length: 80 }, (_, index) => ({ id: crypto.randomUUID(), name: `Project ${index}`, brief: '',
    color: 'pink' as const, resources: [], createdAt: index, updatedAt: index })))
  await page.goto('./')
  const attach = page.getByRole('button', { name: 'Attach workspace', exact: true })
  await expect(attach).toHaveClass(/button-md/)
  await attach.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const alignment = await attach.locator('.app-icon').evaluate((icon) => {
    const plus = document.querySelector('.query-input-add .app-icon')!
    return { attach: icon.getBoundingClientRect().x, plus: plus.getBoundingClientRect().x,
      size: getComputedStyle(icon).fontSize }
  })
  expect(alignment.size).toBe('20px')
  expect(Math.abs(alignment.attach - alignment.plus)).toBeLessThanOrEqual(1)
  await attach.click()
  const menu = page.getByRole('dialog', { name: 'Choose a workspace', exact: true })
  const search = menu.getByRole('searchbox', { name: 'Find a workspace', exact: true })
  await expect(search).toBeFocused()
  expect(await menu.getByRole('menuitem').count()).toBeLessThan(20)
  await search.fill('Project 79')
  const choice = menu.getByRole('menuitem', { name: 'Project 79', exact: true })
  await expect(choice).toBeVisible()
  expect(await choice.locator('.workspace-choice-icon').evaluate((icon) => getComputedStyle(icon).color ===
    getComputedStyle(icon.closest('button')!).color)).toBe(false)
  await search.press('ArrowDown')
  await expect(choice).toBeFocused()
  await choice.press('Enter')
  await expect(page.getByRole('button', { name: 'Project 79', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Project 79', exact: true }).click()
  await menu.getByRole('menuitem', { name: 'New workspace', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'New workspace', exact: true })
  await expect(editor.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.getByRole('button', { name: 'Surprise me', exact: true })).toHaveCount(0)
  await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Fresh idea')
  await editor.getByRole('button', { name: 'Save workspace', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fresh idea', exact: true })).toBeVisible()
})

test('keeps a tall workspace editor scrollable and folder popups independently dismissible', async ({ page, ui }) => {
  const workspaceId = crypto.randomUUID()
  ui.workspaces.push({ id: workspaceId, name: 'Leon', color: 'default', brief: '', createdAt: 1, updatedAt: 1,
    resources: [
      { kind: WorkspaceResourceKind.Link, label: 'Planning', location: 'https://example.com/' },
      ...Array.from({ length: 12 }, (_, index) => ({ kind: WorkspaceResourceKind.Folder, label: `Notes ${index}`, location: `/notes/${index}` }))
    ] })
  await mockFolders(page)
  await page.setViewportSize({ width: 1_100, height: 550 })
  await page.goto(SESSION_URL)
  const row = page.locator('.workspace-row')
  await row.hover()
  await row.getByRole('button', { name: 'Leon options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit workspace', exact: true })
  const bounds = (await editor.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(550)
  const body = editor.locator('.dialog-body')
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  const brief = editor.getByRole('textbox', { name: 'Workspace brief', exact: true })
  await expect(brief).toHaveAttribute('rows', '4')
  await expect(brief).toHaveCSS('resize', 'vertical')
  await editor.getByRole('textbox', { name: 'Folder', exact: true }).click()
  const browser = page.getByRole('dialog', { name: 'Folder', exact: true })
  await expect(browser.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  const folderInput = editor.getByRole('textbox', { name: 'Folder', exact: true })
  await expect(folderInput).toHaveValue('/home/owner/')
  const parent = browser.getByRole('button', { name: '..', exact: true })
  await expect(parent).toBeEnabled()
  await parent.click()
  await expect(folderInput).toHaveValue('/home/')
  await parent.click()
  await expect(folderInput).toHaveValue('/')
  await expect(parent).toBeDisabled()
  await browser.getByRole('button', { name: 'home', exact: true }).click()
  await browser.getByRole('button', { name: 'owner', exact: true }).click()
  const footer = browser.locator('.input-dropdown-footer')
  const attach = footer.getByRole('button', { name: 'Attach this folder', exact: true })
  const geometry = await footer.evaluate((element) => {
    const footer = element.getBoundingClientRect()
    const button = element.querySelector('button')!.getBoundingClientRect()
    const popup = element.closest('.dropdown-content')!.getBoundingClientRect()
    const dialogFooter = document.querySelector('.workspace-dialog > .dialog-footer')!

    return { footerWidth: footer.width, popupWidth: popup.width,
      centered: Math.abs(footer.y + footer.height / 2 - button.y - button.height / 2),
      background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderTop,
      dialogBackground: getComputedStyle(dialogFooter).backgroundColor, dialogBorder: getComputedStyle(dialogFooter).borderTop }
  })
  expect(geometry.footerWidth).toBe(geometry.popupWidth - 2)
  expect(geometry.centered).toBeLessThanOrEqual(1)
  expect(geometry.background).toBe(geometry.dialogBackground)
  expect(geometry.border).toBe(geometry.dialogBorder)
  await attach.click()
  await expect(browser).toBeHidden()
  await expect(editor).toBeVisible()
  await folderInput.click()
  await browser.getByRole('button', { name: 'Projects', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(editor.getByRole('textbox', { name: 'Folder', exact: true })).toBeFocused()
  await expect(browser.getByRole('button', { name: 'Leon', exact: true })).toBeVisible()
  const inputBounds = (await editor.getByRole('textbox', { name: 'Folder', exact: true }).boundingBox())!
  expect((await browser.boundingBox())!.width).toBe(inputBounds.width)
  await editor.getByRole('textbox', { name: 'Folder', exact: true }).press('Enter')
  await expect(editor).toBeVisible()
  await expect(browser).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(browser).toBeHidden()
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Save workspace', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(ui.workspaces[0]!.resources[0]).toEqual({ kind: WorkspaceResourceKind.Link, label: 'Planning', location: 'https://example.com/' })
})


test('explains a folder API mismatch and keeps attachment unavailable without directory metadata', async ({ page, ui }) => {
  void ui
  await page.route('**/api/v1/file-system/list', (route) => route.fulfill({ json: { success: true, entries: [] } }))
  await page.goto('./')
  await page.locator('.session-list-heading').hover()
  await page.getByRole('button', { name: 'New workspace', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'New workspace', exact: true })
  await editor.getByRole('textbox', { name: 'Folder', exact: true }).click()
  const browser = page.getByRole('dialog', { name: 'Folder', exact: true })
  await expect(browser.getByRole('alert')).toHaveText('I need Core to be rebuilt and restarted before I can browse folders.')
  await expect(browser.getByRole('button', { name: 'Attach this folder', exact: true })).toBeDisabled()
  await expect(browser.getByRole('button', { name: '..', exact: true })).toHaveCount(0)
})
