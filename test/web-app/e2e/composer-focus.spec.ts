import type { Page } from '@playwright/test'

import { test, expect, SESSION_URL, OTHER_SESSION_ID, LATEST_ANSWER } from './fixtures'

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
