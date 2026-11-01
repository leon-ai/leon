import type { Locator, Page, Route } from '@playwright/test'
import { TurnPhase } from '../../../server/src/core/llm-manager/turn-timing-contract'
import type { ConversationPage } from '../../../apps/web/src/data/conversation'

import { test, expect, SESSION_ID, OTHER_SESSION_ID, SESSION_URL, LATEST_ANSWER, finishFiniteAnimations } from './fixtures'

async function expectBottom(page: Page): Promise<void> {
  await expect.poll(() => page.locator('.app-main').evaluate((main) =>
    Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop)
  )).toBeLessThanOrEqual(2)
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
}

/**
 * Samples a disclosure heading through its finite motion, including late
 * virtual measurements, so a brief upward jump cannot pass a settled assertion.
 */
function recordDisclosurePositions(trigger: Locator): Promise<number[]> {
  return trigger.evaluate(async (element) => {
    const positions: number[] = []
    let settledFrames = 0
    const maximumFrames = 120
    for (let frame = 0; frame < maximumFrames && settledFrames < 3; frame++) {
      await new Promise(requestAnimationFrame)
      positions.push(element.isConnected ? element.getBoundingClientRect().top : NaN)
      const animating = element.closest('.feed')?.getAnimations({ subtree: true }).some((animation) =>
        animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity
      )
      settledFrames = element.getAttribute('aria-expanded') === 'true' && !animating ? settledFrames + 1 : 0
    }

    return positions
  })
}

test('reveals conversation loading only after one second and cancels it on navigation', async ({ page, ui }) => {
  const now = new Date('2026-11-01T12:00:00Z')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  const loading = page.getByText('Loading conversation…', { exact: true })
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeVisible()
  await expect(loading).toHaveCount(0)
  await page.clock.runFor(999)
  await expect(loading).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(loading).toBeVisible()
  await page.getByRole('link', { name: 'New session', exact: true }).click()
  await expect(page).toHaveURL(/\/web-app\/?$/)
  await page.clock.runFor(1_000)
  await expect(loading).toHaveCount(0)
  release()
  await page.clock.resume()
  await expect(loading).toHaveCount(0)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`expands large groups downward without moving their headings (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 2_000 },
      reasoning: Array.from({ length: 32 }, (_, index) => ({
        id: `thought-${index}`, text: `Consider part ${index}.`, phase: 'agent', startedAt: index + 1
      })),
      toolCalls: Array.from({ length: 128 }, (_, index) => ({
        id: `expand-${index}`, name: 'test.inspect', toolCallTitle: `Inspect part ${index}`,
        status: 'success', output: `Part ${index}`
      }))
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    const work = page.getByRole('button', { name: 'Worked for 2s', exact: true })
    const workTop = (await work.boundingBox())!.y
    const workPositions = recordDisclosurePositions(work)
    await work.click()
    expect(Math.max(...(await workPositions).map((top) => Math.abs(top - workTop)))).toBeLessThan(2)
    await finishFiniteAnimations(page.locator('.feed'))
    const group = page.getByRole('button', { name: 'Used 128 tools', exact: true })
    await group.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const groupTop = (await group.boundingBox())!.y
    const groupPositions = recordDisclosurePositions(group)
    await group.click()
    expect(Math.max(...(await groupPositions).map((top) => Math.abs(top - groupTop)))).toBeLessThan(2)
    await expect(page.getByRole('button', { name: 'Inspect part 0', exact: true })).toBeVisible()
    const leaf = page.getByRole('button', { name: 'Inspect part 0', exact: true })
    await leaf.focus()
    const leafTop = (await leaf.boundingBox())!.y
    const leafPositions = recordDisclosurePositions(leaf)
    await leaf.press('Enter')
    expect(Math.max(...(await leafPositions).map((top) => Math.abs(top - leafTop)))).toBeLessThan(2)
    await expect(page.getByRole('region', { name: 'Tool output', exact: true })).toContainText('Part 0')
    await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).click()
    await expectBottom(page)
  })
}

for (const active of [false, true]) {
  test(`virtualizes long tool groups against the conversation viewport (active: ${active})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    if (active) {
      answer.isAddedToHistory = false
      answer.message = ''
      ui.sessions[0]!.status = 'wip' as typeof ui.sessions[0]['status']
    }
    answer.agentResponseTrace = { id: answer.messageId, planSteps: [], metrics: { durationMs: 2_000 },
      toolCalls: Array.from({ length: 128 }, (_, index) => ({ id: `tool-${index}`, name: 'test.inspect',
        toolCallTitle: `Inspect item ${index}`, status: active && index === 127 ? 'running' : 'success', output: `Result ${index}` })) }
    await page.goto(SESSION_URL)
    if (!active) {
      await page.getByRole('button', { name: 'Worked for 2s', exact: true }).click()
      await page.getByRole('button', { name: 'Used 128 tools', exact: true }).click()
    }
    const list = page.getByRole('region', { name: 'Tool calls', exact: true })
    const main = page.locator('.app-main')
    await expect(list).toBeAttached()
    await finishFiniteAnimations(page.locator('.feed'))
    await main.evaluate((element) => {
      const list = element.querySelector('[aria-label="Tool calls"]')!
      element.scrollTop += list.getBoundingClientRect().top - element.getBoundingClientRect().top - 64
    })
    await expect(list.getByRole('button', { name: 'Inspect item 0', exact: true })).toBeVisible()
    expect(await list.locator('.tool-call').count()).toBeLessThan(50)
    expect(await list.evaluate((element) => element.clientHeight)).toBeGreaterThan(360)
    await main.evaluate((element) => {
      const list = element.querySelector('[aria-label="Tool calls"]')!
      element.scrollTop += list.getBoundingClientRect().bottom - element.getBoundingClientRect().top - element.clientHeight / 2
    })
    await expect(list.getByRole('button', { name: 'Inspect item 127', exact: true })).toBeVisible()
    await expect(page.locator('.feed .scroll-container-viewport')).toHaveCount(0)
    await list.getByRole('button', { name: 'Inspect item 127', exact: true }).click()
    await expect(list.getByLabel('Tool output', { exact: true })).toContainText('Result 127')
  })
}

for (const wasm of [true, false]) {
  test(`keeps file diffs readable outside the JavaScript grammar catalog (Wasm: ${wasm})`, async ({ page, ui }) => {
    if (!wasm) {
      await page.addInitScript(() => Object.defineProperty(window, 'WebAssembly', { value: undefined }))
    }
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 }, toolCalls: [{
        id: 'cpp-edit', name: 'file_system.file.patch', toolCallTitle: 'Adjust the counter', status: 'success',
        input: JSON.stringify({ path: 'counter.cpp', changes: [{ oldText: 'int count = 1;\n', newText: 'int count = 2;\n' }] }),
        output: { result: { success: true, data: { changed: true, diff: '-int count = 1;\n+int count = 2;' } } }
      }]
    }
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
    await page.getByRole('button', { name: 'Used 1 tool', exact: true }).click()
    await page.getByRole('button', { name: 'Adjust the counter', exact: true }).click()
    const diff = page.locator('.feed .tool-diff')
    await expect.poll(() => diff.evaluate((element) =>
      element.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.textContent ?? ''
    )).toContain('count = 2')
    if (wasm) {
      await expect.poll(() => diff.evaluate((element) => Array.from(
        element.querySelector('diffs-container')?.shadowRoot?.querySelectorAll<HTMLSpanElement>('span[style]') ?? []
      ).filter((span) => span.textContent?.trim() === 'int' && span.style.color).length)).toBeGreaterThan(0)
    }
    await expect(diff.getByRole('button')).toHaveCount(0)
    await page.getByRole('button', { name: 'View details', exact: true }).click()
    const dialogDiff = page.getByRole('dialog').locator('.tool-diff')
    await dialogDiff.getByRole('button', { name: 'Split view', exact: true }).click()
    await expect(dialogDiff).toHaveAttribute('data-diff-style', 'split')
    expect(errors).toEqual([])
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`navigates virtual session search from the keyboard without leaving its input (${reducedMotion})`, async ({ page, ui }) => {
    for (let index = ui.sessions.length; index < 80; index++) {
      const session = { ...ui.sessions[0]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Test session ${index}` }
      ui.sessions.push(session)
      ui.history.set(session.id, [])
    }
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const trigger = page.getByRole('button', { name: 'Search sessions', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Search sessions', exact: true })
    const search = dialog.getByRole('combobox', { name: 'Search sessions', exact: true })
    const results = dialog.getByRole('listbox', { name: 'Matching sessions', exact: true })
    await expect(search).toBeFocused()
    await search.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    await expect(search).not.toHaveAttribute('aria-activedescendant')
    await search.press('ArrowDown')
    await expect(results.getByRole('option', { name: /^Test session 0 / })).toHaveAttribute('aria-selected', 'true')
    await search.press('ArrowDown')
    await expect(results.getByRole('option', { name: /^Test session 1 / })).toHaveAttribute('aria-selected', 'true')
    await search.press('ArrowUp')
    await expect(search).toBeFocused()
    await search.fill('Test session')
    await expect.poll(() => ui.requests.some((url) => url.searchParams.get('query') === 'Test session')).toBe(true)
    await search.press('ArrowUp')
    const last = results.getByRole('option', { name: /^Test session 79 / })
    await expect(last).toBeVisible()
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await expect(search).toHaveAttribute('aria-activedescendant', await last.getAttribute('id') ?? '')
    expect(await results.getByRole('option').count()).toBeLessThan(30)
    await search.press('Home')
    expect(await search.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(0)
    await expect(last).toHaveAttribute('aria-selected', 'true')
    await search.fill('no-matching-session')
    await search.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(new RegExp(SESSION_ID))
    await expect(dialog.getByText('No session found.', { exact: true })).toBeVisible()
    await search.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(search).toBeFocused()
    await search.fill('Test session 1')
    await expect(search).toHaveAttribute('aria-busy', 'false')
    await expect(results.getByRole('option', { name: /^Test session 1 / })).toBeVisible()
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  })
}

test('moves sidebar focus across virtual rows without opening a session until Enter', async ({ page, ui }) => {
  for (let index = ui.sessions.length; index < 80; index++) {
    const session = { ...ui.sessions[0]!, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Test session ${index}` }
    ui.sessions.push(session)
    ui.history.set(session.id, [])
  }
  await page.goto(SESSION_URL)
  const first = page.getByRole('link', { name: 'Test session 0', exact: true })
  await first.focus()
  await first.press('End')
  const last = page.getByRole('link', { name: 'Test session 79', exact: true })
  await expect(last).toBeFocused()
  await expect(last).toBeVisible()
  expect(await page.locator('.session-list-item').count()).toBeLessThan(40)
  await last.press('Home')
  await expect(first).toBeFocused()
  await first.press('ArrowDown')
  const second = page.getByRole('link', { name: 'Test session 1', exact: true })
  await expect(second).toBeFocused()
  await expect(page).toHaveURL(new RegExp(SESSION_ID))
  await second.press('Shift+ArrowDown')
  await expect(second).toBeFocused()
  await second.press('Enter')
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
})

test('opens and navigates session action menus with arrows, boundaries and native activation', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  await row.getByRole('link').focus()
  const trigger = row.getByRole('button', { name: 'Session options', exact: true })
  await trigger.focus()
  await trigger.press('ArrowDown')
  const menu = page.getByRole('menu')
  const rename = menu.getByRole('menuitem', { name: 'Rename', exact: true })
  await expect(rename).toBeFocused()
  await rename.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Pin session', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rename).toBeFocused()
  await rename.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await rename.press('Enter')
  const title = page.getByRole('textbox', { name: 'Session title', exact: true })
  await expect(title).toBeFocused()
  await title.press('Home')
  await title.press('ArrowDown')
  await expect(title).toBeFocused()
  await title.press('Escape')
  await row.getByRole('link').focus()
  await trigger.press('Enter')
  await expect(rename).toBeFocused()
  await rename.press('Tab')
  await expect(menu).toBeHidden()
})

test('reveals active session options on hover or keyboard focus rather than selection', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  const link = row.getByRole('link')
  const actions = row.locator('.session-list-item-actions')
  await composer.focus()
  await composer.hover()
  await expect(link).toHaveClass(/session-list-item-active/)
  await expect(actions).toHaveCSS('opacity', '0')
  await row.hover()
  await expect(actions).toHaveCSS('opacity', '1')
  await link.click()
  await composer.hover()
  await expect(actions).toHaveCSS('opacity', '0')
  await link.focus()
  await page.keyboard.press('Tab')
  const options = row.getByRole('button', { name: 'Session options', exact: true })
  await expect(options).toBeFocused()
  await expect(actions).toHaveCSS('opacity', '1')
  await options.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible()
})

test('drafts immediately while history loads and opens the latest messages at the bottom', async ({ page, ui }, testInfo) => {
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
  await composer.fill('Draft before loading')
  await composer.press('Enter')
  await expect(composer).toHaveValue('Draft before loading')
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
  const loading = page.getByRole('status').filter({ hasText: 'Loading conversation…' })
  await expect(loading).toBeVisible()
  await expect(loading.getByRole('button')).toHaveCount(0)
  await expect(loading.locator('.loader-md .loader-indicator')).toHaveCSS('width', '20px')
  await expect(loading.locator('.loader-md .loader-indicator')).toHaveCSS('height', '20px')
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
    await expect.poll(() => loading.evaluate((element) => {
      const form = document.querySelector('.query-input')!.getBoundingClientRect()
      const main = document.querySelector('.app-main')!.getBoundingClientRect()
      const top = main.top + Number.parseFloat(getComputedStyle(document.querySelector('.feed')!).paddingTop)
      const text = element.querySelector('p')!.getBoundingClientRect()
      return Math.max(Math.abs(text.top + text.height / 2 - (top + form.top) / 2),
        Math.abs(text.left + text.width / 2 - form.left - form.width / 2))
    })).toBeLessThanOrEqual(2)
    await page.evaluate(async () => {
      await Promise.allSettled(document.getAnimations().filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished))
    })
    const path = testInfo.outputPath(`loading-${theme}.png`)
    await page.screenshot({ path })
    await testInfo.attach(`loading-${theme}`, { path, contentType: 'image/png' })
  }
  await composer.focus()
  release()
  await expectBottom(page)
  await expect(composer).toHaveValue('Draft before loading')
  await expect(composer).toBeFocused()
  await expect(loading).toHaveCount(0)
  expect(ui.completedRequests.filter((url) => url.pathname.endsWith(SESSION_ID))).toHaveLength(1)
  expect(ui.historyRequests[0]!.searchParams.has('before')).toBe(false)
})

test('reselects the current session at the bottom without discarding its draft', async ({ page, ui }) => {
  void ui
  await page.goto(SESSION_URL)
  await expectBottom(page)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this draft')
  await page.locator('.app-main').evaluate((main) => main.scrollTo({ top: main.scrollTop - 500 }))
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expectBottom(page)
  await expect(composer).toHaveValue('Keep this draft')
  await expect(composer).toBeFocused()
})

test('keeps owner text directly selectable with its bubble selection colors and no tooltip', async ({ page, ui }) => {
  const text = 'A message whose text can be selected.'
  ui.history.get(SESSION_ID)!.at(-2)!.message = text
  await page.goto(SESSION_URL)
  const owner = page.locator('.owner-message').last()
  await expect(owner).toHaveText(text)
  await owner.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
    const selected = await owner.evaluate((element) => {
      const textNode = element.firstChild!
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      const highlight = getComputedStyle(element, '::selection')
      return { text: selection.toString(), plainText: textNode.nodeType === Node.TEXT_NODE && element.childNodes.length === 1,
        background: highlight.backgroundColor, foreground: getComputedStyle(element).color }
    })
    expect(selected.text).toBe(text)
    expect(selected.plainText).toBe(true)
    expect(selected.background).toBe(selected.foreground)
  }
})

test('centers general errors in the usable feed area on session and new-session pages', async ({ page, ui }, testInfo) => {
  ui.failure = { path: '/api/v1/profile-auth', status: 503, message: 'I could not complete this request. Please try again.' }
  for (const url of [SESSION_URL, './']) {
    if (url === SESSION_URL) {
      await page.goto(url)
    } else {
      await page.getByRole('link', { name: 'New session', exact: true }).click()
    }
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    for (const draft of ['', 'A restored draft\nwith several lines\nand more room to type.']) {
      await composer.fill(draft)
      await page.getByRole('form', { name: 'Send a message to Leon' }).evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished))
      })
      await expect.poll(() => alert.evaluate((element) => {
        const form = document.querySelector('.query-input')!.getBoundingClientRect()
        const main = document.querySelector('.app-main')!.getBoundingClientRect()
        const feed = document.querySelector('.feed')
        const top = main.top + (feed ? Number.parseFloat(getComputedStyle(feed).paddingTop) : 0)
        const text = element.querySelector('p')!.getBoundingClientRect()
        const button = element.querySelector('button')!.getBoundingClientRect()
        return Math.max(
          Math.abs((text.top + button.bottom) / 2 - (top + form.top) / 2),
          Math.abs(text.left + text.width / 2 - form.left - form.width / 2),
          Math.abs(button.left + button.width / 2 - form.left - form.width / 2)
        )
      })).toBeLessThanOrEqual(2)
      await expect(alert).toHaveCSS('text-align', 'center')
      await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    }
    const path = testInfo.outputPath(url === './' ? 'new-session-error.png' : 'session-error.png')
    await page.screenshot({ path })
    await testInfo.attach(url === './' ? 'new-session-error' : 'session-error', { path, contentType: 'image/png' })
  }
})

test('updates session titles from metadata-only notifications during and after a turn', async ({ page, ui }) => {
  const errors: Error[] = []
  const handlePageError = (error: Error): void => {
    errors.push(error)
  }
  page.on('pageerror', handlePageError)
  await page.goto(SESSION_URL)
  await expectBottom(page)
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })
    .locator('.streaming-text-character-new')).toHaveCount(0)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this draft while the title changes')
  await ui.emit([{
    type: 'turn_status', sequence: 1, session_id: SESSION_ID, turn_id: 'turn', response_id: null,
    created_at: Date.now(), data: { status: 'accepted' }
  }])
  ui.sessions[0]!.title = 'Generated title while working'
  await ui.emit([{ type: 'sessions_changed' }])
  await expect(page.getByRole('link', { name: 'Generated title while working', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Generated title while working', exact: true })
    .locator('.session-list-item-title-resting .streaming-text-character-new')).not.toHaveCount(0)
  ui.sessions[0]!.title = 'Updated title after completion'
  await ui.emit([{
    type: 'session_changed', sequence: 2, session_id: SESSION_ID, turn_id: 'turn', response_id: null,
    created_at: Date.now(), data: { is_running: false }
  }, { type: 'sessions_changed' }])
  await expect(page.getByRole('link', { name: 'Updated title after completion', exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Keep this draft while the title changes')
  await expect(composer).toBeFocused()
  expect(errors).toEqual([])
  await page.reload()
  await expect(page.getByRole('link', { name: 'Updated title after completion', exact: true })
    .locator('.streaming-text-character-new')).toHaveCount(0)
  page.off('pageerror', handlePageError)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`reveals live titles once while preserving ellipsis, hover scrolling and virtualized remounts (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    for (let index = 3; index < 80; index++) {
      ui.sessions.push({
        ...ui.sessions[1]!,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Older session ${index}`
      })
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    const title = 'A longer generated session title that needs room beyond the row'
    ui.sessions[0]!.title = title
    await ui.emit([{ type: 'sessions_changed' }])
    const link = page.getByRole('link', { name: title, exact: true })
    const resting = link.locator('.session-list-item-title-resting')
    const characters = resting.locator('.streaming-text-character-new')
    await expect(link).toBeVisible()
    await expect(characters).toHaveCount(Array.from(title).length)
    await expect(characters.first()).toHaveCSS('animation-name',
      reducedMotion === 'reduce' ? 'none' : 'streaming-text-character-enter')
    await expect(resting.locator('.streaming-text-characters')).toHaveCSS('white-space', 'nowrap')
    await expect(resting).toHaveCSS('text-overflow', 'ellipsis')
    await expect(link).toHaveCSS('height', '40px')
    await expect(characters.last()).toHaveCSS('opacity', '1')
    const start = await characters.first().evaluate((element) => element.getAnimations()[0]?.startTime ?? null)
    const requests = ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length
    await ui.emit([{ type: 'sessions_changed' }])
    await expect.poll(() => ui.completedRequests.filter((url) => url.pathname.endsWith('/page')).length).toBeGreaterThan(requests)
    expect(await characters.first().evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).toBe(start)
    await link.hover()
    const viewport = link.locator('.session-list-item-title')
    if (reducedMotion === 'reduce') {
      await expect(viewport).not.toHaveClass(/session-list-item-title-scrolling/)
    } else {
      await expect(viewport).toHaveClass(/session-list-item-title-scrolling/)
    }
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(viewport).not.toHaveClass(/session-list-item-title-scrolling/)
    await expect.poll(() => link.locator('.session-list-item-title-text')
      .evaluate((element) => element.getAnimations().length)).toBe(0)
    const sidebar = page.locator('.sidebar-scroll-area')
    await sidebar.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect(link).toHaveCount(0)
    await sidebar.evaluate((element) => element.scrollTo({ top: 0 }))
    await expect(link).toBeVisible()
    await expect(link.locator('.streaming-text-character-new')).toHaveCount(0)
  })

  test(`preserves independent session and new-session drafts across navigation and refresh (${reducedMotion})`, async ({ page, ui }) => {
    void ui
    await page.addInitScript(() => {
      Reflect.set(window, 'draftGeometryTransitions', [])
      document.addEventListener('transitionrun', (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || !target.closest('.query-input') ||
          !['height', 'margin-left', 'margin-right', 'top', 'transform'].includes(event.propertyName)) {
          return
        }
        const field = document.querySelector<HTMLTextAreaElement>('textarea[name="query"]')
        const transitions = Reflect.get(window, 'draftGeometryTransitions') as string[]
        if (field && transitions.length < 64) {
          transitions.push(field.value)
        }
      })
    })
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    const first = page.getByRole('link', { name: 'Test session 0', exact: true })
    const other = page.getByRole('link', { name: 'Test session 1', exact: true })
    const newSession = page.getByRole('link', { name: 'New session', exact: true })
    const draft = 'First draft\n\nKeep these newlines and spaces.  '
    await composer.fill(draft)
    await other.click()
    await expect(composer).toHaveValue('')
    await composer.fill('Other session draft')
    await newSession.click()
    await expect(composer).toHaveValue('')
    await composer.fill('New-session draft')
    await page.evaluate(() => Reflect.set(window, 'draftGeometryTransitions', []))
    await first.click()
    await expect(composer).toHaveValue(draft)
    await expect(composer).toBeFocused()
    expect(await composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]))
      .toEqual([draft.length, draft.length])
    expect(await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      return Reflect.get(window, 'draftGeometryTransitions') as string[]
    })).not.toContain(draft)
    if (reducedMotion === 'no-preference') {
      await expect(page.getByRole('form', { name: 'Send a message to Leon' })).toHaveCSS('transition-property', 'height')
    }
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue(draft)
    await page.goBack()
    await expect(composer).toHaveValue('New-session draft')
    await page.goForward()
    await expect(composer).toHaveValue(draft)
    await page.reload()
    await expect(composer).toHaveValue(draft)
    expect(await composer.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]))
      .toEqual([draft.length, draft.length])
    expect(await page.evaluate(() => Reflect.get(window, 'draftGeometryTransitions') as string[])).not.toContain(draft)
    await other.click()
    await expect(composer).toHaveValue('Other session draft')
    await newSession.click()
    await page.reload()
    await expect(composer).toHaveValue('New-session draft')
  })

  test(`opens tall saved answers at the bottom with intact whitespace (${reducedMotion})`, async ({ page, ui }) => {
    const lines = Array.from({ length: 90 }, (_, index) =>
      `Saved line ${index + 1}: this paragraph keeps its own line and spacing.`
    )
    const text = lines.join('\n\n')
    ui.history.get(SESSION_ID)!.at(-1)!.message = text
    await page.emulateMedia({ reducedMotion })
    const expectSavedAnswer = async (): Promise<void> => {
      const answer = page.getByRole('region', { name: 'Leon’s final answer' })
        .filter({ hasText: lines.at(-1)! })
      await expect(answer.locator('.streaming-text-characters')).toHaveCSS('white-space', 'pre-wrap')
      expect(await answer.innerText()).toBe(text)
      await expect.poll(() => page.locator('.app-main').evaluate((main) =>
        Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop)
      )).toBeLessThanOrEqual(2)
      await expect(answer.locator('.streaming-text-character-new')).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    }

    await page.goto(SESSION_URL)
    await expectSavedAnswer()
    await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await expectSavedAnswer()
    await page.locator('.app-main').evaluate((main) => main.scrollTo({ top: main.scrollTop - 500 }))
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await expectSavedAnswer()
    await page.reload()
    await expectSavedAnswer()
  })
}

test('saves drafts only when leaving and removes submitted or manually cleared text', async ({ page, ui }) => {
  void ui
  await page.addInitScript(() => {
    let count = 0
    Object.defineProperty(window, 'draftStorageWriteCount', { get: () => count })
    for (const method of ['setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (key: string, value = ''): void {
        if (this === window.sessionStorage) {
          count++
        }
        Reflect.apply(original, this, [key, value])
      }
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  const first = page.getByRole('link', { name: 'Test session 0', exact: true })
  const other = page.getByRole('link', { name: 'Test session 1', exact: true })
  const writes = (): Promise<number> => page.evaluate(() => Reflect.get(window, 'draftStorageWriteCount') as number)
  await composer.pressSequentially('Unsent text')
  expect(await writes()).toBe(0)
  await other.click()
  expect(await writes()).toBe(1)
  await first.click()
  await expect(composer).toHaveValue('Unsent text')
  expect(await writes()).toBe(1)
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await composer.press('Enter')
  await expect(page.getByText('Completed Unsent text', { exact: true })).toBeVisible()
  await other.click()
  expect(await writes()).toBe(2)
  await first.click()
  await expect(composer).toHaveValue('')
  await composer.fill('To clear manually')
  await other.click()
  await first.click()
  await expect(composer).toHaveValue('To clear manually')
  await composer.fill('')
  await page.reload()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('')
})

test('isolates profile drafts and prioritizes new typing while authentication resolves', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
  await composer.fill('First profile draft')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  ui.profile = 'another-ui-profile'
  await page.reload()
  await expect(composer).toBeFocused()
  await expect(page.getByRole('link', { name: 'Test session 0', exact: true })).toBeVisible()
  await expect(composer).toHaveValue('')
  await composer.fill('Another profile draft')
  await page.reload()
  await expect(composer).toHaveValue('Another profile draft')
  expect(await composer.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe('Another profile draft'.length)
  ui.profile = 'ui-tests'
  await page.reload()
  await expect(composer).toHaveValue('First profile draft')

  const release = ui.holdAuthentication()
  try {
    await page.reload()
    await composer.fill('New typing before authentication')
    await composer.press('Home')
    release()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
    await expect(composer).toHaveValue('New typing before authentication')
    expect(await composer.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(0)
    await page.reload()
    await expect(composer).toHaveValue('New typing before authentication')
  } finally {
    release()
  }
})

test('keeps drafting usable and reports browser storage failures', async ({ page, ui }) => {
  void ui
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (this === window.sessionStorage) {
        throw new DOMException('Storage is full.', 'QuotaExceededError')
      }
      setItem.call(this, key, value)
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this text available')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByText('Draft was not saved', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('Keep this text available')
  await expect(composer).toBeEnabled()
})

test('reopens an evicted latest window without fetching older cursors first', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  for (let index = 0; index < 10; index++) {
    const response = page.waitForResponse((candidate) => new URL(candidate.url()).searchParams.has('before'))
    await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    await response
    await expect(page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'Back to latest messages' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  const frontier = ui.historyRequests.length
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expectBottom(page)
  const reopened = ui.historyRequests.slice(frontier).filter((url) => url.pathname.endsWith(SESSION_ID))
  expect(reopened.length).toBeGreaterThan(0)
  expect(reopened.every((url) => !url.searchParams.has('before') && !url.searchParams.has('after'))).toBe(true)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`loads history on scroll with a shared loader and a stable reading position (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    await page.emulateMedia({ reducedMotion })
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], metrics: { durationMs: 1_000 },
      toolCalls: [{ id: 'history-tool', name: 'test.inspect', toolCallTitle: 'Inspect history', status: 'success' }]
    }
    await page.goto(SESSION_URL)
    await expectBottom(page)
    // Inspecting turn details must not disable the history-prepend anchor.
    await page.getByRole('button', { name: 'Worked for 1s', exact: true }).click()
    await finishFiniteAnimations(page.locator('.feed'))
    expect(ui.historyRequests).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0)
    const release = ui.holdHistory()
    await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    const loading = page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })
    await expect(loading).toBeVisible()
    await expect(loading.locator('.loader-indicator')).toHaveCSS('width', '12px')
    await expect(loading.locator('.loader-indicator')).toHaveCSS('height', '12px')
    await expect.poll(() => loading.locator('.loader-indicator').evaluate((element) =>
      getComputedStyle(element, '::before').animationName
    )).toBe(reducedMotion === 'reduce' ? 'none' : 'loader-indicator-pulse')
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition')
      await expect(loading.locator('.loader-indicator')).toHaveCSS('color', 'rgb(28, 117, 219)')
      await expect(loading).toHaveCSS('color', 'rgb(136, 136, 136)')
      const bounds = await loading.boundingBox()
      const mask = await page.locator('.feed-mask-top').boundingBox()
      expect(bounds!.y).toBeGreaterThan(mask!.y + mask!.height)
      await page.screenshot({ path: testInfo.outputPath(`history-loader-${theme}.png`) })
    }
    expect(ui.historyRequests).toHaveLength(2)
    const firstOwner = page.getByText('Saved question 220', { exact: true })
    const before = await firstOwner.boundingBox()
    release()
    await expect(loading).toHaveCount(0)
    await expect.poll(async () => Math.abs((await firstOwner.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(2)
    expect(ui.historyRequests).toHaveLength(2)
  })
}

test('keeps older history readable after a paging failure and retries only on request', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  await finishFiniteAnimations(page.locator('.feed'))
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'History is unavailable.' }
  await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
  const retry = page.getByRole('button', { name: 'Retry loading earlier messages', exact: true })
  await expect(retry).toBeVisible()
  await expect(page.locator('.request-feedback')).toHaveCount(0)
  await expect(page.getByText('Saved question 220', { exact: true })).toBeVisible()
  await expect(page.locator('.toast-title')).toHaveText(['Could not load the conversation'])
  const requests = ui.requests.filter((url) => url.searchParams.has('before')).length
  await page.getByRole('textbox', { name: 'Message Leon' }).fill('Keep this draft')
  await expect(retry).toBeEnabled()
  expect(ui.requests.filter((url) => url.searchParams.has('before'))).toHaveLength(requests)
  ui.failure = undefined
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toHaveValue('Keep this draft')
})

for (const shortWindow of [false, true]) {
  test(`continues history loading without another scroll (short window: ${shortWindow})`, async ({ page, ui }) => {
    const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/v1/sessions/${SESSION_ID}`)
    await page.goto(SESSION_URL)
    const snapshot = await (await response).json() as ConversationPage
    await expectBottom(page)
    const records = ui.history.get(SESSION_ID)!
    const first = records.length - (shortWindow ? 2 : snapshot.messages.length)
    let olderReads = 0
    await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
      const before = new URL(route.request().url()).searchParams.get('before')
      if (before) {
        olderReads++
      }
      await route.fulfill({ json: {
        ...snapshot,
        messages: before === 'first-older' ? records.slice(first - 2, first)
          : before === 'older-tail' ? records.slice(first - 42, first - 2) : records.slice(first),
        next_cursor: before === 'older-tail' ? null : before ? 'older-tail' : 'first-older',
        newer_cursor: before ? String(first) : null
      } })
    })
    await page.reload()
    if (!shortWindow) {
      await expectBottom(page)
      await page.locator('.app-main').evaluate((element) => element.scrollTo({ top: 0 }))
    }
    await expect.poll(() => olderReads).toBe(2)
    await expect(page.getByRole('status').filter({ hasText: 'Loading earlier messages…' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Load earlier messages', exact: true })).toHaveCount(0)
  })
}

test('reports a shared history failure once and keeps the draft through manual recovery', async ({ page, ui }) => {
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'History is unavailable.' }
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Keep this during recovery')
  await expect(page.locator('.toast-title')).toHaveText(['Could not load the conversation'])
  ui.failure = undefined
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expectBottom(page)
  await expect(composer).toHaveValue('Keep this during recovery')
})

test('rolls back a rejected model setting and reports it through the shared toast', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  await expectBottom(page)
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}/model`, status: 400, message: 'Unsupported setting.' }
  await page.locator('.model-settings-trigger').click()
  await page.getByRole('radio', { name: 'Low', exact: true }).click()
  await expect(page.locator('.toast-title')).toHaveText(['Model settings were not saved'])
  await expect(page.locator('.model-settings-trigger')).toContainText('High')
})

test('gives network-specific feedback and keeps drafting available through offline recovery', async ({ page, context, ui }) => {
  let disconnected = true
  await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
    if (disconnected) {
      await route.abort('internetdisconnected')
    } else {
      await route.fallback()
    }
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('A draft during an outage')
  const notice = page.getByRole('alert')
  await expect(notice).toContainText('I couldn’t reach the server. Check your network connection and try again.')
  const retry = notice.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeEnabled()
  const text = await notice.locator('p').boundingBox()
  const button = await retry.boundingBox()
  expect(button!.y).toBeGreaterThanOrEqual(text!.y + text!.height)
  await expect(page.locator('.toast-error')).toHaveCount(1)
  disconnected = false
  await retry.click()
  await expectBottom(page)
  await expect(notice).toHaveCount(0)
  await expect(composer).toHaveValue('A draft during an outage')
  await context.setOffline(true)
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(notice).toContainText('Check your network connection and try again.')
  await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled()
  await composer.fill('Another offline draft')
  await context.setOffline(false)
  await expect(notice).toHaveCount(0)
  await expect(composer).toHaveValue('Another offline draft')
  void ui
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows leaf dates as metadata and reveals full dates only from the timestamp (${reducedMotion})`, async ({ page, ui }) => {
    await page.emulateMedia({ reducedMotion })
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+08:00'))
    const startedAt = await page.evaluate(() => new Date(2026, 9, 30, 14, 32, 15).getTime())
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.sentAt = startedAt + 3_000
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [],
      toolCalls: [{ id: 'dated-tool', name: 'test.lookup.run', toolCallTitle: 'Look up details',
        status: 'success', startedAt, durationMs: 618 }],
      reasoning: [{ id: 'dated-thought', text: 'Check the details.', phase: 'agent', startedAt }],
      timings: [{ id: 'dated-request', kind: 'inference', goal: TurnPhase.Tools,
        startedAt, durationMs: 1_000, outcome: 'completed' }],
      answerStartedAt: startedAt + 2_000, metrics: { durationMs: 3_000 }
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work', exact: true })
    await work.getByRole('button', { name: 'Worked for 3s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 1 tool for 618ms', exact: true }).click()
    const tool = work.getByRole('button', { name: 'Look up details' })
    const timestamp = work.locator('.tool-call-heading .activity-timestamp time')
    const badge = timestamp.locator('..')
    const tooltip = page.getByRole('tooltip')
    await expect(timestamp).toHaveText('Yesterday, 14:32')
    await page.getByRole('textbox', { name: 'Message Leon' }).focus()
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(badge).toHaveCSS('opacity', '0')
    const reservedWidth = (await badge.boundingBox())!.width
    expect(reservedWidth).toBeGreaterThan(0)
    expect(await timestamp.evaluate((element) => {
      const date = getComputedStyle(element)
      const duration = getComputedStyle(element.closest('.tool-call-heading')!.querySelector('.tool-call-duration')!)
      return date.color === duration.color && date.fontSize === duration.fontSize && date.lineHeight === duration.lineHeight
    })).toBe(true)
    const motion = await badge.evaluate((element) => {
      const date = getComputedStyle(element)
      const chevron = getComputedStyle(element.closest('.tool-call-heading')!.querySelector('.tool-call-chevron')!)
      return { property: date.transitionProperty, duration: date.transitionDuration, easing: date.transitionTimingFunction,
        chevronDuration: chevron.transitionDuration.split(', ')[0], chevronEasing: chevron.transitionTimingFunction }
    })
    if (reducedMotion === 'reduce') {
      expect(motion.property).toBe('none')
    } else {
      expect(motion.property).toBe('opacity')
      expect(motion.duration).toBe(motion.chevronDuration)
      expect(motion.chevronEasing).toContain(motion.easing)
    }
    await tool.hover()
    await expect(badge).toHaveCSS('opacity', '1')
    expect((await badge.boundingBox())!.width).toBe(reservedWidth)
    await expect(tooltip).toHaveCount(0)
    await timestamp.hover()
    await expect(tooltip).toHaveText('2026-10-30 14:32:15')
    const bounds = await tooltip.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(badge).toHaveCSS('opacity', '0')
    await expect(tooltip).toHaveCount(0)
    await tool.focus()
    await expect(badge).toHaveCSS('opacity', '1')
    await expect(tooltip).toHaveCount(0)
    await tool.press('Enter')
    await expect(tool).toBeFocused()
    await expect(tool).toHaveAttribute('aria-expanded', 'true')
    await expect(tooltip).toHaveCount(0)
    await timestamp.focus()
    await expect(tooltip).toHaveText('2026-10-30 14:32:15')
    await tool.focus()
    await expect(tooltip).toHaveCount(0)
    const thought = work.getByRole('region', { name: 'Leon’s thinking', exact: true })
    await thought.getByRole('button').click()
    await expect(thought.locator('.thinking-message-details')).toBeVisible()
    expect(await thought.evaluate((element) => {
      const details = element.querySelector('.thinking-message-details')!.getBoundingClientRect()
      const label = element.querySelector('.process-group-title')!.getBoundingClientRect()
      return Math.abs(details.left - label.left)
    })).toBeLessThanOrEqual(1)
    await thought.hover()
    await thought.locator('.activity-timestamp time').hover()
    await expect(tooltip).toContainText('2026-10-30 14:32:15')
    await page.getByRole('textbox', { name: 'Message Leon' }).hover()
    await expect(tooltip).toHaveCount(0)
    await page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last()
      .locator('.streaming-text-characters').hover()
    await expect(tooltip).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Leon’s final answer', exact: true }).last().locator('.activity-timestamp')).toHaveCount(0)
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 3s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 1 tool for 618ms', exact: true }).click()
    await tool.hover()
    await timestamp.hover()
    await expect(tooltip).toContainText('2026-10-30 14:32:15')
  })
}

test('confirms session management actions once and only after the server accepts them', async ({ page, ui }) => {
  let pending = Promise.withResolvers<Route>()
  await page.route(`**/api/v1/sessions/${SESSION_ID}?*`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fallback()
      return
    }
    pending.resolve(route)
  })
  await page.goto(SESSION_URL)
  let title = 'Test session 0'
  for (const action of ['renamed', 'pinned', 'unpinned', 'deleted']) {
    const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })
    await row.hover()
    await row.getByRole('button', { name: 'Session options', exact: true }).click()
    if (action === 'renamed') {
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Session title', exact: true })
      await input.fill('Renamed session')
      await input.press('Enter')
    } else if (action === 'deleted') {
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete session', exact: true }).click()
    } else {
      await page.getByRole('menuitem', { name: action === 'pinned' ? 'Pin session' : 'Unpin session', exact: true }).click()
    }
    const route = await pending.promise
    pending = Promise.withResolvers<Route>()
    await expect(page.locator('.toast')).toHaveCount(0)
    const session = ui.sessions[0]!
    if (action === 'deleted') {
      expect(route.request().method()).toBe('DELETE')
      ui.sessions.shift()
      await route.fulfill({ json: { success: true } })
    } else {
      expect(route.request().method()).toBe('PATCH')
      const changes = route.request().postDataJSON() as { title?: string, is_pinned?: boolean }
      if (changes.title !== undefined) {
        session.title = changes.title
        title = changes.title
      } else {
        session.isPinned = changes.is_pinned!
      }
      await route.fulfill({ json: { session } })
    }
    await expect(page.locator('.toast-success .toast-title')).toHaveText([`Session ${action}`])
    await expect(page.locator('.toast')).toHaveCount(1)
    if (action === 'deleted') {
      await expect(page).toHaveURL(/\/web-app\/$/)
      await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Close notification', exact: true }).click()
    await expect(page.locator('.toast')).toHaveCount(0)
  }
})

test('reports a rejected session action once without confirming success', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}`, status: 500, message: 'Session update rejected.' }
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Test session 0', exact: true }) })
  await row.hover()
  await row.getByRole('button', { name: 'Session options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Pin session', exact: true }).click()
  await expect(page.locator('.toast-error .toast-title')).toHaveText(['Session could not be updated'])
  await expect(page.locator('.toast')).toHaveCount(1)
  await expect(row).not.toHaveClass(/session-list-item-pinned/)
})

test('cancels obsolete history silently when switching sessions', async ({ page, ui }) => {
  const release = ui.holdHistory()
  await page.goto(SESSION_URL)
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await composer.fill('Only the active session')
  release()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  await expect(composer).toHaveValue('Only the active session')
  await expect(page.getByText(LATEST_ANSWER, { exact: true })).toHaveCount(0)
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('retries failed delivery with the original message ID instead of duplicating it', async ({ page, ui }) => {
  await page.goto(`session/${OTHER_SESSION_ID}`)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.fill('Retry delivery')
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  ui.failure = { path: `/api/v1/sessions/${OTHER_SESSION_ID}/messages`, status: 500, message: 'Delivery failed.' }
  const delivery = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await composer.press('Enter')
  const first = (await delivery).postDataJSON() as { id: string }
  await expect(page.locator('.toast-title')).toHaveText(['Message delivery was not confirmed'])
  ui.failure = undefined
  const retry = page.waitForRequest((request) => request.url().endsWith('/messages'))
  await page.getByRole('button', { name: 'Retry sending message' }).click()
  expect(((await retry).postDataJSON() as { id: string }).id).toBe(first.id)
  await expect(page.getByText('Completed Retry delivery', { exact: true })).toBeVisible()
  await expect(page.getByText('Retry delivery', { exact: true })).toHaveCount(1)
})

for (const status of ['success', 'error'] as const) {
  test(`keeps recorded tool outcomes quiet and durations centered in both themes (${status})`, async ({ page, ui }, testInfo) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [{
        id: 'lookup', name: 'search.lookup.run', status,
        toolCallTitle: 'Look up information', toolIconName: 'search-line', startedAt: 0, durationMs: 1_500
      }],
      metrics: { durationMs: 2_000 }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 2s' }).click()
    await page.getByRole('button', { name: 'Used 1 tool for 2s', exact: true }).click()
    const tool = page.getByRole('button', { name: 'Look up information' })
    await expect(tool).toBeVisible()
    await expect(tool.locator('.tool-call-duration')).toHaveText('1.5s')
    await expect(tool.locator('.activity-wave-active')).toHaveCount(0)
    await expect(tool.locator('.tool-call-error-indicator')).toHaveCount(status === 'error' ? 1 : 0)
    await expect(tool.locator('.ri-check-line, .ri-check-fill')).toHaveCount(0)

    for (const theme of ['dark', 'light']) {
      await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme)
      if (status === 'error') {
        await expect(tool).toHaveAccessibleDescription('Tool call failed')
        await expect(tool.locator('.tool-call-error-indicator.ri-close-line')).toHaveCSS('color', 'rgb(172, 10, 10)')
      }
      const title = await tool.locator('.tool-call-title').boundingBox()
      const duration = await tool.locator('.tool-call-duration').boundingBox()
      expect(title).not.toBeNull()
      expect(duration).not.toBeNull()
      expect(Math.abs(title!.y + title!.height / 2 - duration!.y - duration!.height / 2)).toBeLessThanOrEqual(1)
      if (status === 'error') {
        const indicator = await tool.locator('.tool-call-error-indicator').boundingBox()
        expect(indicator).not.toBeNull()
        expect(Math.abs(indicator!.y + indicator!.height / 2 - duration!.y - duration!.height / 2)).toBeLessThanOrEqual(0.25)
      }
      await testInfo.attach(`tool-duration-${theme}`, { body: await tool.screenshot(), contentType: 'image/png' })
    }
  })
}

test('preserves sub-second tool totals in milliseconds after reloading', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [],
    toolCalls: [
      { id: 'first', name: 'test.lookup.run', status: 'success', durationMs: 125.2 },
      { id: 'second', name: 'test.lookup.run', status: 'success', durationMs: 84.3 }
    ],
    metrics: { durationMs: 400 }
  }

  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 400ms', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true })).toBeVisible()
  await page.reload()
  await work.getByRole('button', { name: 'Worked for 400ms', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true })).toBeVisible()
  await work.getByRole('button', { name: 'Used 2 tools for 210ms', exact: true }).click()
  await expect(work.locator('.tool-call-title')).toHaveText(['Run', 'Run'])
  await expect(work.getByText('test.lookup.run', { exact: true })).toHaveCount(0)
})

for (const completeTiming of [true, false]) {
  test(`shows cumulative tool execution only with complete timing (${completeTiming})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [
        { id: 'short', name: 'search.lookup.run', status: 'success', startedAt: 2_000, durationMs: 2_000 },
        { id: 'long', name: 'search.lookup.run', status: 'success', startedAt: 0, durationMs: 12_000 },
        {
          id: 'middle', name: 'search.lookup.run', status: 'success', startedAt: 1_000,
          ...(completeTiming ? { durationMs: 5_000 } : {})
        }
      ],
      metrics: { durationMs: 14_000 }
    }

    await page.goto(SESSION_URL)
    await page.getByRole('button', { name: 'Worked for 14s' }).click()
    // Accumulated execution can exceed the wall-clock turn when calls overlap.
    const label = completeTiming ? 'Used 3 tools for 19s' : 'Used 3 tools'
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Worked for 14s' }).click()
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  })
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows measured generation and review inside the full turn total (${reducedMotion})`, async ({ page, ui }, testInfo) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId,
      planSteps: [],
      toolCalls: [
        { id: 'first', name: 'search.lookup.run', status: 'success', startedAt: 0, durationMs: 618 },
        { id: 'second', name: 'search.lookup.run', status: 'success', startedAt: 6_500, durationMs: 435 }
      ],
      metrics: {
        durationMs: 20_000, reviewCount: 1, reviewDurationMs: 3_000,
        phaseMetrics: { final_answer: { durationMs: 5_000 } }
      }
    }
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 20s', exact: true }).click()
    await work.getByRole('button', { name: 'Used 2 tools for 1s', exact: true }).click()
    await expect(work.locator('.tool-call-duration')).toHaveText(['618ms', '435ms'])
    const generation = work.getByRole('region', { name: 'Leon’s answer generation' })
    const review = work.getByRole('region', { name: 'Leon’s review' })
    await expect(generation).toHaveText('Generated answer in 5s')
    await expect(review).toHaveText('Reviewed for 3s')
    await expect(generation.locator('.ri-pencil-ai-line')).toHaveCount(1)
    await expect(review.locator('.ri-search-eye-line')).toHaveCount(1)
    await expect(generation.getByRole('button')).toHaveCount(0)
    await expect(review.getByRole('button')).toHaveCount(0)
    await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
    await testInfo.attach('completed-work', { body: await work.screenshot(), contentType: 'image/png' })
    await page.reload()
    await work.getByRole('button', { name: 'Worked for 20s', exact: true }).click()
    await expect(generation).toHaveText('Generated answer in 5s')
    await expect(review).toHaveText('Reviewed for 3s')
  })
}

test('omits absent or unmeasured phases instead of estimating their duration', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.llmMetrics = { durationMs: 4_000, reviewCount: 0, reviewDurationMs: 0 }
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], toolCalls: [],
    reasoning: [{ id: 'thought', phase: 'agent', startedAt: 0, text: 'Considered the request.' }],
    metrics: { phaseMetrics: { final_answer: { durationMs: 0 } } }
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 4s', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Thought', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Leon’s review' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Leon’s answer generation' })).toHaveCount(0)
})

test('shows structured plans without duplicate legacy widget answers while retaining other widget content', async ({ page, ui }) => {
  ui.history.set(SESSION_ID, [{
    who: 'owner', messageId: 'old-owner', message: 'An older request.', sentAt: 0, isAddedToHistory: true
  }, {
    who: 'leon', messageId: 'old-plan', message: 'Legacy-only plan', sentAt: 1,
    isAddedToHistory: false, widget: { widget: 'PlanWidget' }
  }, {
    who: 'owner', messageId: 'new-owner', message: 'A planned request.', sentAt: 2, isAddedToHistory: true
  }, {
    who: 'leon', messageId: 'other-widget', message: 'Another widget result', sentAt: 3,
    isAddedToHistory: false, widget: { widget: 'OtherWidget' }
  }, {
    who: 'leon', messageId: 'duplicate-plan', message: 'Verify playback paths', sentAt: 4,
    isAddedToHistory: false, widget: { widget: 'PlanWidget' }
  }, {
    who: 'leon', messageId: 'planned-answer', message: 'The final answer.', sentAt: 5,
    isAddedToHistory: true, agentResponseTrace: {
      id: 'planned-answer', planSteps: [{ id: 'step', label: 'Verify playback paths', status: 'completed' }],
      toolCalls: [], metrics: { durationMs: 5_000 }
    }
  }])
  await page.goto(SESSION_URL)
  for (const reload of [false, true]) {
    if (reload) {
      await page.reload()
    }
    const answers = page.getByRole('region', { name: 'Leon’s final answer', exact: true })
    await expect(answers).toHaveCount(3)
    await expect(answers.nth(0)).toContainText('Legacy-only plan')
    await expect(answers.nth(1)).toContainText('Another widget result')
    await expect(answers.nth(2)).toContainText('The final answer.')
    await expect(answers.filter({ hasText: 'Verify playback paths' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Worked for 5s', exact: true }).click()
    await page.getByRole('button', { name: 'Completed plan', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Execution plan' })).toContainText('Verify playback paths')
  }
})

test('shows phase summaries from saved message metrics without a detailed trace', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.llmMetrics = {
    durationMs: 12_000, reviewCount: 1, reviewDurationMs: 2_000,
    phaseMetrics: { final_answer: { durationMs: 3_000 } }
  }
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Leon’s review' })).toHaveText('Reviewed for 2s')
  await expect(page.getByRole('region', { name: 'Leon’s answer generation' })).toHaveText('Generated answer in 3s')
})

for (const retryCount of [0, 1, 4]) {
  test(`shows only the recorded retry count (${retryCount}) without changing turn timing`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.agentResponseTrace = {
      id: answer.messageId, planSteps: [], toolCalls: [],
      inferences: retryCount === 4 ? [
        { startedAt: 0, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
        { startedAt: 500, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
        { startedAt: 1_000, elapsedMs: 500, phase: 'agent' },
        { startedAt: 1_500, elapsedMs: 500, phase: 'review', retryDecision: 'retry' },
        { startedAt: 2_000, elapsedMs: 500, phase: 'review' }
      ] : [
        { startedAt: 0, elapsedMs: 500, phase: 'agent' },
        { startedAt: 500, elapsedMs: 500, phase: 'agent', retryDecision: 'stop' },
        { startedAt: 1_000, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' }
      ],
      metrics: {
        durationMs: 12_000, reviewCount: 1, reviewDurationMs: 2_000,
        reviewRetryCount: retryCount === 4 ? 2 : retryCount
      }
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
    const retries = work.getByRole('region', { name: 'Leon’s retries' })
    if (retryCount === 0) {
      await expect(retries).toHaveCount(0)
    } else {
      const label = `Retried ${retryCount} ${retryCount === 1 ? 'time' : 'times'}`
      await expect(retries.locator('.process-group-title')).toHaveText(label)
      await expect(retries.locator('.ri-refresh-line')).toHaveCount(1)
      await expect(retries.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(retries.locator('.process-group-title')).toHaveText(label)
    }
  })
}

test('shows retries from the final live trace without refreshing history', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  const event = {
    type: 'final_answer', sequence: 1, session_id: SESSION_ID,
    turn_id: 'question-239', response_id: answer.messageId, created_at: answer.sentAt,
    data: {
      content: answer.message, artifacts: [],
      response_trace: {
        inferences: [
          { startedAt: 0, elapsedMs: 500, phase: 'agent', retryDecision: 'retry' },
          { startedAt: 500, elapsedMs: 500, phase: 'agent' },
          { startedAt: 1_000, elapsedMs: 500, phase: 'review', retryDecision: 'retry' },
          { startedAt: 1_500, elapsedMs: 500, phase: 'review' }
        ],
        metrics: { durationMs: 12_000, otherProcessingDurationMs: 3_000 }
      }
    }
  }
  await page.route('**/api/v1/sessions/events?*', async (route) => {
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(event)}\n\n` })
  })
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Leon’s retries' }).locator('.process-group-title')).toHaveText('Retried 2 times')
  await expect(page.getByRole('region', { name: 'Leon’s other processing' })).toHaveText('Other processing for 3s')
  expect(ui.completedRequests.filter((url) => url.pathname.endsWith(SESSION_ID))).toHaveLength(1)
})

test('accounts for tool selection and intermediate model requests alongside execution and the answer', async ({ page, ui }) => {
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [],
    toolCalls: [{ id: 'lookup', name: 'test.lookup.run', status: 'success', durationMs: 5_000 }],
    timings: [
      { id: 'selection', kind: 'inference', goal: 'tool-selection', startedAt: 0, durationMs: 4_000, outcome: 'completed' },
      { id: 'answer', kind: 'inference', goal: 'answer-generation', startedAt: 9_000, durationMs: 2_000, outcome: 'completed' }
    ],
    metrics: {
      durationMs: 11_000, modelProcessingDurationMs: 4_000,
      phaseMetrics: { final_answer: { durationMs: 2_000 } }
    }
  }
  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 11s', exact: true }).click()
  await expect(work.getByRole('button', { name: 'Used 1 tool for 5s', exact: true })).toBeVisible()
  await work.getByRole('button', { name: 'Processed for 6s', exact: true }).click()
  await expect(work.getByRole('region', { name: 'Leon’s inference', exact: true }).locator('.process-group-title')).toHaveText(['Processed tool request in 4s', 'Generated answer in 2s'])
})

test('keeps thoughts separate and closes completed work with categorized model requests', async ({ page, ui }) => {
  const categories = [
    { goal: TurnPhase.ToolSchemas, label: 'Loaded tool schemas in', icon: 'stack-line' },
    { goal: TurnPhase.ToolRequest, label: 'Prepared tool calls in', icon: 'wrench-line' },
    { goal: TurnPhase.Skill, label: 'Loaded skills in', icon: 'book-open-line' },
    { goal: TurnPhase.Plan, label: 'Updated plan in', icon: 'list-check-3' },
    { goal: TurnPhase.Clarification, label: 'Requested clarification in', icon: 'question-mark' },
    { goal: TurnPhase.Answer, label: 'Generated answer in', icon: 'pencil-ai-line' },
    { goal: TurnPhase.Review, label: 'Reviewed for', icon: 'search-eye-line' },
    { goal: TurnPhase.Inspection, label: 'Inspected images in', icon: 'eye-2-line' },
    { goal: TurnPhase.Compaction, label: 'Compacted context in', icon: 'file-reduce-line' }
  ]
  const answer = ui.history.get(SESSION_ID)!.at(-1)!
  answer.agentResponseTrace = {
    id: answer.messageId, planSteps: [], toolCalls: [],
    reasoning: [{ id: 'independent-thought', phase: 'agent', startedAt: 0, text: 'Reviewing the evidence.' }],
    timings: categories.map((category, index) => ({
      id: `request-${index}`, kind: 'inference', goal: category.goal,
      startedAt: index * 1_000, durationMs: 1_000, outcome: 'completed'
    })),
    metrics: { durationMs: 12_000, otherProcessingDurationMs: 3_000 }
  }

  await page.goto(SESSION_URL)
  const work = page.getByRole('region', { name: 'Leon’s completed work' })
  await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
  const processing = work.getByRole('region', { name: 'Leon’s processing', exact: true })

  await expect(work.getByRole('region', { name: 'Leon’s thinking', exact: true })).toHaveCount(1)
  await expect(work.locator('.leon-message-activities').first().locator(':scope > :last-child'))
    .toHaveAttribute('aria-label', 'Leon’s processing')
  await processing.getByRole('button', { name: 'Processed for 9s', exact: true }).click()
  await expect(processing.getByRole('region', { name: 'Leon’s thinking', exact: true })).toHaveCount(0)

  for (const category of categories) {
    const request = processing.getByRole('region', { name: 'Leon’s inference', exact: true })
      .filter({ hasText: `${category.label} 1s` })
    await expect(request).toHaveCount(1)
    await expect(request.locator(`.ri-${category.icon}`)).toHaveCount(1)
  }
})

for (const otherDuration of [undefined, 0, 500, 3_000]) {
  test(`shows only meaningful measured other processing (${otherDuration})`, async ({ page, ui }) => {
    const answer = ui.history.get(SESSION_ID)!.at(-1)!
    answer.llmMetrics = {
      durationMs: 12_000, phaseMetrics: { final_answer: { durationMs: 4_000 } },
      ...(otherDuration === undefined ? {} : { otherProcessingDurationMs: otherDuration })
    }
    await page.goto(SESSION_URL)
    const work = page.getByRole('region', { name: 'Leon’s completed work' })
    await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
    const other = work.getByRole('region', { name: 'Leon’s other processing' })
    if (otherDuration === 3_000) {
      await expect(other).toHaveText('Other processing for 3s')
      await expect(other.locator('.ri-more-line')).toHaveCount(1)
      await expect(other.getByRole('button')).toHaveCount(0)
      await page.reload()
      await work.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
      await expect(other).toHaveText('Other processing for 3s')
    } else {
      await expect(other).toHaveCount(0)
    }
  })
}
