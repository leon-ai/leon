import type { Page } from '@playwright/test'


import { test, expect, SESSION_URL, SESSION_ID, OTHER_SESSION_ID, LATEST_ANSWER } from './fixtures'

async function countWaves(page: Page): Promise<number> {
  return page.evaluate(() => Reflect.get(window, 'composerWaveCount') as number)
}

test.beforeEach(async ({ page, ui }) => {
  void ui
  await page.addInitScript(() => {
    let count = 0
    const seen = new WeakSet<Element>()
    Object.defineProperty(window, 'composerWaveCount', { get: () => count })
    new MutationObserver(() => {
      for (const wave of document.querySelectorAll('.query-input-focus-wave')) {
        if (!seen.has(wave)) {
          seen.add(wave)
          count++
        }
      }
    }).observe(document, { childList: true, subtree: true })
  })
})

test('keeps autofocus, refresh, navigation and browser focus restoration silent', async ({ page, context }) => {
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  expect(await countWaves(page)).toBe(0)
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(OTHER_SESSION_ID))
  await expect(composer).toBeFocused()
  expect(await countWaves(page)).toBe(0)
  await page.reload()
  await expect(composer).toBeFocused()
  const otherPage = await context.newPage()
  await otherPage.goto('about:blank')
  await otherPage.bringToFront()
  await page.bringToFront()
  await composer.blur()
  await composer.focus()
  expect(await countWaves(page)).toBe(0)
  await otherPage.close()
})

test('plays on a blurred-to-focused pointer transition, not clicks while already focused', async ({ page }) => {
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await composer.click()
  expect(await countWaves(page)).toBe(0)
  await page.getByRole('button', { name: 'Add attachment' }).click()
  await composer.click()
  await expect.poll(() => countWaves(page)).toBe(1)
  await expect(page.locator('.query-input-focus-wave')).toHaveCount(0)
  await composer.fill('Typing does not restart the wave')
  await composer.click()
  expect(await countWaves(page)).toBe(1)
})

test('plays on keyboard Tab focus but not programmatic focus', async ({ page }) => {
  await page.goto(SESSION_URL)
  const attachment = page.getByRole('button', { name: 'Add attachment' })
  await attachment.focus()
  await page.getByRole('textbox', { name: 'Message Leon' }).focus()
  expect(await countWaves(page)).toBe(0)
  await attachment.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
  await expect.poll(() => countWaves(page)).toBe(1)
})

test('respects reduced motion on deliberate focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(SESSION_URL)
  await page.getByRole('button', { name: 'Add attachment' }).click()
  await page.getByRole('textbox', { name: 'Message Leon' }).click()
  expect(await countWaves(page)).toBe(0)
})

test('recalls only from empty input and keeps normal caret navigation after editing', async ({ page, ui }) => {
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  const requests = (): number => ui.requests.filter((url) => url.pathname.endsWith('/queries')).length
  expect(requests()).toBe(0)
  await composer.fill('My own\nmultiline draft')
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('My own\nmultiline draft')
  expect(requests()).toBe(0)
  await composer.fill('')
  await composer.dispatchEvent('keydown', { key: 'ArrowUp', isComposing: true })
  await composer.press('Shift+ArrowUp')
  expect(requests()).toBe(0)
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 239')
  await expect.poll(() => composer.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe('Saved question 239'.length)
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 238')
  await composer.press('ArrowDown')
  await expect(composer).toHaveValue('Saved question 239')
  await composer.press('ArrowDown')
  await expect(composer).toHaveValue('')
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 239')
  await composer.press('End')
  await composer.press('!')
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 239!')
  expect(requests()).toBe(1)
})

test('recalls 128 queries lazily without changing the feed or fetching beyond the limit', async ({ page, ui }) => {
  ui.history.set(SESSION_ID, Array.from({ length: 133 }, (_, index) => ({
    who: 'owner', messageId: `query-${index}`, message: `Query ${index}`,
    sentAt: index, isAddedToHistory: true
  })))
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  const feedRequests = ui.historyRequests.length
  for (let index = 132; index >= 5; index--) {
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue(`Query ${index}`)
  }
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Query 5')
  expect(ui.requests.filter((url) => url.pathname.endsWith('/queries'))).toHaveLength(3)
  expect(ui.historyRequests).toHaveLength(feedRequests)
  await composer.press('ArrowDown')
  await expect(composer).toHaveValue('Query 6')
})

test('recalls newly submitted queries after refresh and isolates navigation between sessions', async ({ page, ui }) => {
  ui.history.get(OTHER_SESSION_ID)!.push({
    who: 'owner', messageId: 'other-query', message: 'Other session query', sentAt: 1, isAddedToHistory: true
  })
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 239')
  await composer.fill('My latest query')
  await composer.press('Enter')
  await expect(page.getByText('Completed My latest query', { exact: true })).toBeVisible()
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('My latest query')
  await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Other session query')
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(composer).toHaveValue('My latest query')
  await composer.fill('')
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('My latest query')
  await page.reload()
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('My latest query')
  await composer.fill('')
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('My latest query')
})

test('does not overwrite drafts or another session when a history request finishes late', async ({ page, ui }) => {
  let release!: () => void
  let gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  await page.route('**/sessions/*/queries?**', async (route) => {
    started = true
    await gate
    await route.fallback()
  })
  try {
    await page.goto(SESSION_URL)
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    await composer.press('ArrowUp')
    await expect.poll(() => started).toBe(true)
    await composer.fill('Do not replace this draft')
    release()
    await expect.poll(() => ui.completedRequests.filter((url) => url.pathname.endsWith('/queries')).length).toBe(1)
    await expect(composer).toHaveValue('Do not replace this draft')
    await composer.fill('')
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue('Saved question 239')
    await page.getByRole('link', { name: 'Test session 1', exact: true }).click()
    await expect(composer).toHaveValue('')
    started = false
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = page.waitForRequest((request) =>
      request.url().includes(`/sessions/${OTHER_SESSION_ID}/queries`))
    await composer.press('ArrowUp')
    const request = await pending
    await expect.poll(() => started).toBe(true)
    await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
    await composer.fill('A different session draft')
    release()
    await request.response()
    await expect(composer).toHaveValue('A different session draft')
  } finally {
    release()
  }
})

test('reports failed history reads in a toast and allows another recall attempt', async ({ page, ui }) => {
  ui.failure = { path: `/api/v1/sessions/${SESSION_ID}/queries`, status: 400, message: 'Query history is unavailable.' }
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await composer.press('ArrowUp')
  await expect(page.getByText('Could not load query history', { exact: true })).toBeVisible()
  await expect(composer).toHaveValue('')
  ui.failure = undefined
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue('Saved question 239')
})

test('bounds long-query text without truncating recalled input', async ({ page, ui }) => {
  test.setTimeout(60_000)
  const message = 'Long query '.repeat(8_000)
  ui.history.set(SESSION_ID, Array.from({ length: 100 }, (_, index) => ({
    who: 'owner', messageId: `long-${index}`, message: `${message}${index}`,
    sentAt: index, isAddedToHistory: true
  })))
  await page.goto(SESSION_URL)
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  for (let index = 99; index >= 89; index--) {
    await composer.press('ArrowUp')
    await expect(composer).toHaveValue(`${message}${index}`)
  }
  await composer.press('ArrowUp')
  await expect(composer).toHaveValue(`${message}89`)
  const requests = ui.requests.filter((url) => url.pathname.endsWith('/queries'))
  expect(requests).toHaveLength(12)
  expect(Number(requests.at(-1)!.searchParams.get('characters'))).toBeLessThan(message.length)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`returns to drafting after scrolling to the bottom with ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto(SESSION_URL)
    await expect(page.getByText(LATEST_ANSWER, { exact: true })).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Message Leon' })
    await composer.fill('Keep drafting after scrolling')
    const main = page.locator('.app-main')
    const scrollButton = page.getByRole('button', { name: 'Scroll to bottom' })

    for (const activation of ['pointer', 'keyboard']) {
      await expect.poll(() => main.evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
      )).toBeLessThanOrEqual(2)
      await main.evaluate((element) => element.scrollTo({ top: element.scrollTop - 800 }))
      await expect(scrollButton).toBeVisible()
      if (activation === 'pointer') {
        await scrollButton.click()
      } else {
        await scrollButton.focus()
        await scrollButton.press('Enter')
      }

      await expect(composer).toBeFocused()
      await expect(composer).toHaveValue('Keep drafting after scrolling')
      await expect.poll(() => main.evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
      )).toBeLessThanOrEqual(2)
      expect(await countWaves(page)).toBe(0)
    }
  })
}

test('plays one entrance wave on each new-session landing, including refresh', async ({ page }) => {
  await page.goto('./')
  const composer = page.getByRole('textbox', { name: 'Message Leon' })
  await expect(composer).toBeFocused()
  await expect.poll(() => countWaves(page)).toBe(1)
  await expect(page.locator('.query-input-focus-wave')).toHaveCount(0)
  await composer.click()
  expect(await countWaves(page)).toBe(1)
  await page.getByRole('link', { name: 'Test session 0', exact: true }).click()
  await expect(composer).toBeFocused()
  expect(await countWaves(page)).toBe(1)
  await page.getByRole('link', { name: 'New session', exact: true }).click()
  await expect.poll(() => countWaves(page)).toBe(2)
  await page.reload()
  await expect.poll(() => countWaves(page)).toBe(1)
})

for (const panel of ['models', 'settings']) {
  test(`restores ${panel} selector focus without a pointer outline and retains keyboard outlines`, async ({ page }) => {
    await page.goto(SESSION_URL)
    const trigger = panel === 'models'
      ? page.getByRole('button', { name: 'Choose model, current: OpenAI, GPT-6.1 Sol', exact: true })
      : page.getByRole('button', { name: 'Model settings, Reasoning: High, service tier: Auto', exact: true })
    const popup = page.getByRole('dialog', { name: panel === 'models' ? 'Choose a model' : 'Model settings', exact: true })

    await trigger.click()
    await expect(popup).toBeVisible()
    if (panel === 'models') {
      await popup.getByRole('combobox').fill('gpt 61')
    }
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveCSS('outline-style', 'none')

    await trigger.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(trigger).toBeFocused()
    await expect(trigger).not.toHaveCSS('outline-style', 'none')
    await trigger.press('Enter')
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(trigger).not.toHaveCSS('outline-style', 'none')
  })
}

test('restores a pointer-opened session menu without an outline', async ({ page }) => {
  await page.goto(SESSION_URL)
  await page.getByRole('link', { name: 'Test session 0', exact: true }).hover()
  const trigger = page.getByRole('button', { name: 'Session options', exact: true }).first()
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveCSS('outline-style', 'none')
})
