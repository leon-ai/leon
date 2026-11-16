import { WorkspaceResourceKind } from '../../../bridges/runtime/contracts/workspace'

import type { Page, Route } from '@playwright/test'

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

for (const motion of ['normal', 'reduced', 'zero duration'] as const) {
  test(`closes workspace editors through the shared dialog lifecycle (${motion})`, async ({ page, ui }) => {
    void ui
    await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' })
    await page.goto('./')
    // A longer transition lets us inspect the fade without a wall-clock race.
    await page.addStyleTag({ content: `.dialog-overlay, .dialog { transition-duration: ${motion === 'zero duration' ? '0s' : '2s'}; }` })

    for (const entry of ['sidebar', 'composer'] as const) {
      if (entry === 'sidebar') {
        await page.locator('.session-list-heading').hover()
        await page.locator('.sidebar').getByRole('button', { name: 'New workspace', exact: true }).click()
      } else {
        await page.getByRole('button', { name: 'Attach workspace', exact: true }).click()
        await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click()
      }
      const editor = page.getByRole('dialog', { name: 'New workspace', exact: true })
      const overlay = page.locator('.dialog-overlay').filter({ has: editor })
      await finishFiniteAnimations(overlay)
      if (entry === 'sidebar') {
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      } else {
        await editor.press('Escape')
      }
      if (motion === 'normal') {
        const opacity = await overlay.evaluate((element) => {
          const transition = element.getAnimations().find((animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === 'opacity')
          if (!transition?.effect) {
            return null
          }
          transition.pause()
          transition.currentTime = Number(transition.effect.getComputedTiming().duration) / 2
          const opacity = Number(getComputedStyle(element).opacity)
          transition.finish()

          return opacity
        })
        expect(opacity).not.toBeNull()
        expect(opacity).toBeGreaterThan(0)
        expect(opacity).toBeLessThan(1)
      }
      await expect(editor).toHaveCount(0)
      await expect(overlay).toHaveCount(0)
    }
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
    const callout = editor.getByRole('complementary')
    await expect(callout).toContainText('I use this context to keep my help focused.')
    await expect(callout.locator('br')).toHaveCount(0)
    await expect(callout.locator('[data-icon="lightbulb"]')).toBeVisible()
    const inputBackground = await editor.getByRole('textbox', { name: 'Workspace name' })
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    await expect(callout).toHaveCSS('background-color', inputBackground)
    const formBounds = (await editor.locator('form').boundingBox())!
    const calloutBounds = (await callout.boundingBox())!
    expect(calloutBounds.width).toBe(formBounds.width)
    expect(calloutBounds.y).toBe(formBounds.y)
    for (const previewWidth of [width, 390, 320]) {
      await page.setViewportSize({ width: previewWidth, height: 844 })
      const lines = await callout.locator('.callout-content').evaluate((element) =>
        element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight))
      if (previewWidth === width) {
        expect(lines).toBe(2)
      }
      const content = callout.locator('.callout-content')
      expect(await content.evaluate((element) => element.scrollHeight <= element.clientHeight
        && element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    await page.setViewportSize({ width, height: 982 })
    const save = editor.getByRole('button', { name: 'Save workspace', exact: true })
    await expect(save).toBeDisabled()
    await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Leon')
    await editor.getByRole('textbox', { name: 'Workspace brief' }).fill('I am building my open-source AI assistant.')
    const pink = editor.getByRole('button', { name: 'Leon pink', exact: true })
    await pink.click()
    if (motion === 'no-preference') {
      const ring = await pink.evaluate((element) => {
        const transition = element.getAnimations().find((animation) =>
          animation instanceof CSSTransition && animation.transitionProperty === 'outline-color')
        if (!transition?.effect) {
          return null
        }
        transition.pause()
        transition.currentTime = Number(transition.effect.getComputedTiming().duration) / 2
        const color = getComputedStyle(element).outlineColor
        transition.finish()

        return { color, target: getComputedStyle(element).color }
      })
      expect(ring).not.toBeNull()
      expect(ring!.color).not.toBe(ring!.target)
      expect(ring!.color).not.toBe('rgba(0, 0, 0, 0)')
    } else {
      await expect(pink).toHaveCSS('transition-duration', '0s')
    }
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
    await expect(edit).toHaveCount(0)
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

test('matches workspace row geometry and keeps collapsed unread results', async ({ page, ui }) => {
  await page.addInitScript(() => localStorage.setItem('leon.web-app.accent', 'violet'))
  const workspaceId = '10000000-0000-4000-8000-000000000000'
  ui.workspaces.push({ id: workspaceId, name: 'Hearthlight', brief: 'Cozy films', color: 'amber', resources: [], createdAt: 1, updatedAt: 1 })
  const other = ui.sessions[1]!
  other.workspaceId = workspaceId
  await page.goto(SESSION_URL)
  const expand = page.getByRole('button', { name: 'Expand Hearthlight', exact: true })
  const row = page.locator('.workspace-row')
  const options = row.getByRole('button', { name: 'Hearthlight options', exact: true })
  await page.getByRole('textbox', { name: 'Message Leon' }).hover()
  await expect(row.locator('.session-list-item-actions')).toHaveCSS('opacity', '0')
  await row.hover()
  await expect(row.locator('.session-list-item-actions')).toHaveCSS('opacity', '1')
  await options.click()
  await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Pin', 'Delete'])
  await page.keyboard.press('Escape')
  await ui.emit([{ sequence: 5, type: 'turn_status', session_id: other.id, turn_id: 'film', response_id: 'answer', created_at: 1,
    data: { status: 'completed', workspace_id: workspaceId } }])
  await page.getByRole('textbox', { name: 'Message Leon' }).focus()
  await page.getByRole('textbox', { name: 'Message Leon' }).hover()
  await expect(row.getByLabel('Unread results')).toBeVisible()
  const accent = await page.locator('.sidebar-update-button .app-icon').evaluate((icon) => getComputedStyle(icon).color)
  const workspaceColor = await row.locator('.workspace-row-icon').evaluate((icon) => getComputedStyle(icon).color)
  await expect(row.getByLabel('Unread results')).toHaveCSS('background-color', accent)
  expect(accent).not.toBe(workspaceColor)
  await expand.click()
  const child = page.locator(`a[data-session-id="${other.id}"]`)
  await expect(child).toBeVisible()
  const flat = page.locator(`a[data-session-id="${SESSION_ID}"]`)
  const unselected = page.locator(`a[data-session-id="${ui.sessions[2]!.id}"]`)
  await unselected.hover()
  const hoverColor = await unselected.evaluate((element) => getComputedStyle(element).backgroundColor)
  await row.hover()
  await expect(row.locator('.session-list-item-link')).toHaveCSS('background-color', hoverColor)
  const geometry = await row.evaluate((element, ids) => {
    const root = element.querySelector('.session-list-item-link')!
    const child = document.querySelector(`a[data-session-id="${ids.child}"]`)!
    const flat = document.querySelector(`a[data-session-id="${ids.flat}"]`)!
    return {
      rootWidth: root.getBoundingClientRect().width, childWidth: child.getBoundingClientRect().width,
      flatWidth: flat.getBoundingClientRect().width,
      rootTextX: root.querySelector('.session-list-item-title')!.getBoundingClientRect().x,
      childTextX: child.querySelector('.session-list-item-title')!.getBoundingClientRect().x,
      radius: getComputedStyle(root).borderRadius, flatRadius: getComputedStyle(flat).borderRadius,
      lineHeight: getComputedStyle(root.querySelector('.session-list-item-title')!).lineHeight,
      flatLineHeight: getComputedStyle(flat.querySelector('.session-list-item-title')!).lineHeight
    }
  }, { child: other.id, flat: SESSION_ID })
  expect(geometry.childWidth).toBe(geometry.flatWidth)
  expect(geometry.rootWidth).toBe(geometry.flatWidth)
  expect(geometry.childTextX).toBe(geometry.rootTextX)
  expect(geometry.radius).toBe(geometry.flatRadius)
  expect(geometry.lineHeight).toBe(geometry.flatLineHeight)
  await child.hover()
  await child.locator('..').getByRole('button', { name: 'Session options', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Move to workspace…', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Collapse Hearthlight', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Leon' }).focus()
  await page.getByRole('textbox', { name: 'Message Leon' }).hover()
  await expect(row.getByLabel('Unread results')).toBeVisible()
  await expand.click()
  await child.click()
  await expect(page.locator('.session-page-workspace')).toHaveCount(0)
  await expect(page.locator('.workspace-selector')).toHaveCount(0)
  await expect(row.getByLabel('Unread results')).toHaveCount(0)
  await expect(flat).toBeVisible()
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`discloses workspaces for mouse and keyboard without double-click renaming (${reducedMotion})`, async ({ page, ui }) => {
    ui.workspaces.push({ id: '10000000-0000-4000-8000-000000000000', name: 'Hearthlight', brief: 'Films', color: 'amber', resources: [], createdAt: 1, updatedAt: 1 })
    await page.emulateMedia({ reducedMotion })
    const response = Promise.withResolvers<void>()
    let childRequests = 0
    await page.route((url) => url.pathname.endsWith('/sessions/page') && url.searchParams.has('workspace_id'), async (route) => {
      childRequests++
      await response.promise
      await route.fulfill({ json: { sessions: [], next_cursor: null, event_cursor: 0 } })
    })
    try {
      await page.goto(SESSION_URL)
      const list = page.locator('.session-list-items')
      const height = (await list.boundingBox())!.height
      const expand = page.getByRole('button', { name: 'Expand Hearthlight', exact: true })
      await expand.click()
      const collapse = page.getByRole('button', { name: 'Collapse Hearthlight', exact: true })
      await expect(collapse).toBeVisible()
      expect((await list.boundingBox())!.height).toBe(height)
      await expect(page.getByRole('button', { name: 'Loading conversations…', exact: true })).toHaveCount(0)
      expect(childRequests).toBe(0)
      await collapse.focus()
      await collapse.press('Enter')
      await expect(expand).toBeVisible()
      await expand.dblclick()
      await expect(expand).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Workspace name', exact: true })).toHaveCount(0)
    } finally {
      response.resolve()
    }
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`collapses Recents, reveals creation actions and aligns row controls (${reducedMotion})`, async ({ page, ui }) => {
    ui.workspaces.push({ id: '10000000-0000-4000-8000-000000000000', name: 'Leon', brief: '', color: 'default', resources: [], createdAt: 1, updatedAt: 1 })
    ui.sessions[0]!.isPinned = true
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const heading = page.locator('.session-list-heading')
    const actions = heading.locator('.session-list-heading-actions')
    const recents = heading.getByRole('button', { name: 'Recents', exact: true })
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(actions).toHaveCSS('visibility', 'hidden')
    await recents.hover()
    await expect(actions).toHaveCSS('visibility', 'visible')
    await expect(recents.locator('.app-icon')).toHaveCSS('rotate', '90deg')
    await expect(recents.locator('.app-icon')).toHaveCSS('translate', '0px 1px')
    await recents.click()
    if (reducedMotion === 'no-preference') {
      const halfway = await recents.locator('.app-icon').evaluate((icon) => {
        const transition = icon.getAnimations().find((animation) =>
          animation instanceof CSSTransition && animation.transitionProperty === 'rotate')
        if (!transition?.effect) {
          return null
        }
        transition.pause()
        transition.currentTime = Number(transition.effect.getComputedTiming().duration) / 2
        const angle = Number.parseFloat(getComputedStyle(icon).rotate)
        transition.finish()

        return angle
      })
      expect(halfway).toBeGreaterThan(0)
      expect(halfway).toBeLessThan(90)
    }
    await expect(recents).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.session-list-items')).toBeHidden()
    await expect(recents.locator('.app-icon')).toHaveCSS('rotate', '0deg')
    await page.reload()
    await expect(recents).toHaveAttribute('aria-expanded', 'false')
    await recents.focus()
    await recents.press('Enter')
    await expect(page.locator('.session-list-items')).toBeVisible()
    const row = page.locator('.workspace-row')
    await row.hover()
    const create = row.getByRole('button', { name: 'New session in Leon', exact: true })
    await expect(create).toBeVisible()
    const close = page.getByRole('button', { name: 'Close sidebar', exact: true })
    const options = row.getByRole('button', { name: 'Leon options', exact: true })
    const center = async (locator: typeof close): Promise<number> => locator.locator('.app-icon').evaluate((icon) => {
      const bounds = icon.getBoundingClientRect()
      return bounds.x + bounds.width / 2
    })
    expect(Math.abs(await center(options) - await center(close))).toBeLessThanOrEqual(1)
    await options.hover()
    await expect(options).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await recents.hover()
    const newSession = heading.getByRole('button', { name: 'New session', exact: true })
    await newSession.hover()
    await expect(newSession).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const geometry = async (button: typeof newSession): Promise<unknown> => button.evaluate((element) => {
      const style = getComputedStyle(element)

      return { width: style.width, height: style.height, padding: style.padding,
        iconSize: getComputedStyle(element.querySelector('.app-icon')!).fontSize }
    })
    const metadataGeometry = await geometry(page.getByRole('button', { name: 'Turn info', exact: true }).last())
    for (const name of ['New session', 'New workspace']) {
      expect(await geometry(heading.getByRole('button', { name, exact: true }))).toEqual(metadataGeometry)
    }
    expect(Math.abs(await center(newSession) - await center(close))).toBeLessThanOrEqual(1)
    const flat = page.locator(`a[data-session-id="${SESSION_ID}"]`).locator('..')
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    const pin = flat.locator('.session-list-item-pinned-icon')
    await expect(pin).toHaveAttribute('data-icon', 'pushpin')
    const bounds = (await pin.boundingBox())!
    expect(Math.abs(bounds.x + bounds.width / 2 - await center(close))).toBeLessThanOrEqual(1)
    await row.hover()
    await create.click()
    await expect(page).toHaveURL(/workspace=/)
  })
}

test('pins a workspace directly and inherits its conversations’ pins independently', async ({ page, ui }) => {
  const workspaceId = '10000000-0000-4000-8000-000000000000'
  ui.workspaces.push({ id: workspaceId, name: 'Leon', brief: '', color: 'pink', resources: [], createdAt: 1, updatedAt: 1 })
  ui.sessions[1]!.workspaceId = workspaceId
  await page.goto(SESSION_URL)
  const row = page.locator('.workspace-row')
  const options = row.getByRole('button', { name: 'Leon options', exact: true })
  await row.hover()
  await options.click()
  await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Pin', 'Delete'])
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(row).toHaveClass(/session-list-item-pinned/)
  await row.hover()
  await options.click()
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await expect(row).not.toHaveClass(/session-list-item-pinned/)
  await row.getByRole('button', { name: 'Expand Leon', exact: true }).click()
  const child = page.locator(`a[data-session-id="${ui.sessions[1]!.id}"]`).locator('..')
  await child.hover()
  await child.getByRole('button', { name: 'Session options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(child).toHaveClass(/session-list-item-pinned/)
  await expect(row).toHaveClass(/session-list-item-pinned/)
  await row.getByRole('button', { name: 'Collapse Leon', exact: true }).click()
  await expect(row.locator('.session-list-item-pinned-icon')).toBeVisible()
  await page.reload()
  await expect(row).toHaveClass(/session-list-item-pinned/)
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
      ...['/home/owner/', '/home/owner/Projects/Leon/', '/home/owner/Projects/Notes/'].map((location, index) => ({
        kind: WorkspaceResourceKind.Folder, label: `Notes ${index}`, location
      }))
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


test('shows progress on the closed workspace or its open running conversation', async ({ page, ui }) => {
  const workspaceId = crypto.randomUUID()
  ui.workspaces.push({ id: workspaceId, name: 'Leon', color: 'default', brief: '', resources: [], createdAt: 1, updatedAt: 1 })
  const running = ui.sessions[1]!
  running.workspaceId = workspaceId
  running.status = 'wip' as typeof running.status
  await page.goto(SESSION_URL)
  const workspace = page.locator('.workspace-row')
  await expect(workspace).toHaveClass(/session-list-item-wip/)
  await workspace.getByRole('button', { name: 'Expand Leon', exact: true }).click()
  const child = page.locator(`a[data-session-id="${running.id}"]`).locator('..')
  await expect(child).toHaveClass(/session-list-item-wip/)
  await expect(workspace).not.toHaveClass(/session-list-item-wip/)
  await workspace.getByRole('button', { name: 'Collapse Leon', exact: true }).click()
  await expect(workspace).toHaveClass(/session-list-item-wip/)
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


test('delays folder loading feedback per lookup and clears completed or cancelled notices', async ({ page, ui }) => {
  void ui
  const outstanding = new Set<Route>()
  let nextRequest = Promise.withResolvers<Route>()
  await page.route('**/api/v1/file-system/list', (route) => {
    outstanding.add(route)
    nextRequest.resolve(route)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await page.goto('./')
  await page.locator('.session-list-heading').hover()
  await page.getByRole('button', { name: 'New workspace', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'New workspace', exact: true })
  const folder = editor.getByRole('textbox', { name: 'Folder', exact: true })
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1_000))
  const browser = page.getByRole('dialog', { name: 'Folder', exact: true })
  const loading = browser.getByText('Loading folders…', { exact: true })
  try {
    await folder.click()
    const home = await nextRequest.promise
    await page.clock.runFor(200)
    await expect(loading).toHaveCount(0)
    await home.fulfill({ json: { success: true, directory: '/home/owner/', parent: '/home/',
      entries: [{ name: 'Projects', absolutePath: '/home/owner/Projects/' }] } })
    outstanding.delete(home)
    // Network completion queues cache notifications after the response is fulfilled.
    await expect.poll(async () => {
      await page.clock.runFor(1)

      return browser.getByRole('button', { name: 'Projects', exact: true }).count()
    }).toBe(1)
    await page.clock.runFor(500)
    await expect(loading).toHaveCount(0)

    nextRequest = Promise.withResolvers<Route>()
    await browser.getByRole('button', { name: 'Projects', exact: true }).click()
    await nextRequest.promise
    await page.clock.runFor(200)
    await expect(loading).toHaveCount(0)
    await page.clock.runFor(200)
    await expect(loading).toBeVisible()

    nextRequest = Promise.withResolvers<Route>()
    await folder.fill('/home/owner/Notes/')
    const notes = await nextRequest.promise
    await expect(loading).toHaveCount(0)
    await page.clock.runFor(200)
    await expect(loading).toHaveCount(0)
    await notes.fulfill({ json: { success: true, directory: '/home/owner/Notes/', parent: '/home/owner/', entries: [] } })
    outstanding.delete(notes)
    await expect.poll(async () => {
      await page.clock.runFor(1)

      return browser.getByRole('button', { name: 'Attach this folder', exact: true }).isEnabled()
    }).toBe(true)
    await page.clock.runFor(500)
    await expect(loading).toHaveCount(0)

    nextRequest = Promise.withResolvers<Route>()
    await folder.fill('/home/owner/Films/')
    await nextRequest.promise
    await page.clock.runFor(200)
    await folder.press('Escape')
    await page.clock.runFor(500)
    await expect(browser).toBeHidden()
    await expect(page.getByText('Loading folders…', { exact: true })).toHaveCount(0)
  } finally {
    await Promise.allSettled([...outstanding].map((route) => route.abort()))
  }
})
