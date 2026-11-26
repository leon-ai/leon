import { test, expect, SESSION_URL } from './fixtures'

for (const desktop of [false, true]) {
  for (const macOS of [false, true]) {
    test(`uses platform shortcuts with protected editing and dialogs (${desktop ? 'desktop' : 'web'}, ${macOS ? 'macOS' : 'Windows'})`, async ({ page, ui }) => {
      void ui
      const modifier = macOS ? 'Meta' : 'Control'
      const otherModifier = macOS ? 'Control' : 'Meta'
      await page.addInitScript((apple) => {
        // Exercise the ordinary platform fallback as well as Chromium's hints.
        Object.defineProperty(navigator, 'userAgentData', { configurable: true,
          value: apple ? { platform: 'macOS' } : undefined })
        Object.defineProperty(navigator, 'platform', { configurable: true, value: apple ? 'MacIntel' : 'Win32' })
      }, macOS)
      if (desktop) {
        await page.route('**/web-app/**', async (route) => {
          if (!route.request().isNavigationRequest()) {
            await route.fallback()
            return
          }
          const response = await route.fetch()
          await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="leon-desktop" content="true">') })
        })
      }
      await page.goto(SESSION_URL)
      const composer = page.getByRole('textbox', { name: 'Message Leon' })
      const newSession = page.getByRole('link', { name: 'New session', exact: true })
      const search = page.getByRole('dialog', { name: 'Search sessions', exact: true })
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await composer.fill('Keep this draft')
      await expect(newSession).toHaveAttribute('aria-keyshortcuts', desktop
        ? `${modifier}+O ${modifier}+Shift+O` : `${modifier}+Shift+O`)
      await expect(newSession.locator('.menu-item-shortcut').getByText('Shift', { exact: true })).toHaveCount(desktop ? 0 : 1)
      await page.keyboard.press(`${otherModifier}+k`)
      await expect(search).toHaveCount(0)
      await composer.dispatchEvent('keydown', { key: 'k', ctrlKey: !macOS, metaKey: macOS, isComposing: true })
      await composer.dispatchEvent('keydown', { key: 'k', ctrlKey: !macOS, metaKey: macOS, repeat: true })
      await expect(search).toHaveCount(0)
      await page.keyboard.press(`${modifier}+k`)
      await expect(search).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(search).toHaveCount(0)
      await page.keyboard.press(`${modifier}+Comma`)
      await expect(settings).toBeVisible()
      await settings.dispatchEvent('keydown', { key: 'o', ctrlKey: !macOS, metaKey: macOS, shiftKey: !desktop })
      await expect(settings).toBeVisible()
      await settings.getByRole('button', { name: 'Close dialog' }).click()
      await expect(settings).toHaveCount(0)
      await expect(composer).toHaveValue('Keep this draft')
      if (desktop) {
        await page.keyboard.press(`${modifier}+o`)
        await expect(page).toHaveURL(/\/web-app\/$/)
        await page.goto(SESSION_URL)
        await expect(composer).toBeVisible()
      } else {
        // Leave the browser-owned Open command untouched without opening an OS picker.
        const handled = await composer.evaluate((field, apple) => {
          const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true })
          field.dispatchEvent(event)
          return event.defaultPrevented
        }, macOS)
        expect(handled).toBe(false)
        await expect(page).toHaveURL(new RegExp(`${SESSION_URL}$`))
      }
      await page.keyboard.press(`${modifier}+Shift+o`)
      await expect(page).toHaveURL(/\/web-app\/$/)
      await expect(page.getByRole('textbox', { name: 'Message Leon' })).toBeFocused()
    })
  }
}
