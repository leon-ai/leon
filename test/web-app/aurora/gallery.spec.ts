import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { AURORA_QUERY_EXAMPLES } from '../../fixtures/aurora'
import { createConnectionPreview } from '../../fixtures/connections'
import { finishFiniteAnimations } from '../e2e/fixtures'
import { createFeedPreviewExamples } from '../../fixtures/feed-preview'

const CONNECTIONS = [...fs.globSync('tools/*/*/tool.json')].flatMap((file) => {
  const connection = createConnectionPreview(JSON.parse(fs.readFileSync(file, 'utf8')))

  return connection ? [connection] : []
})

for (const [theme, reducedMotion] of [['light', 'reduce'], ['dark', 'no-preference']] as const) {
  test(`explores real feed activity states and complete turns without API requests (${theme}, ${reducedMotion})`, async ({ page }, testInfo) => {
    const unexpectedRequests: string[] = []
    const errors: string[] = []
    const origin = new URL(testInfo.project.use.baseURL!).origin
    const modules: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().startsWith('data:') || request.url().startsWith('blob:')) {
        return
      }
      const url = new URL(request.url())
      modules.push(url.pathname)
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        unexpectedRequests.push(request.url())
      }
    })
    await page.emulateMedia({ reducedMotion })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    expect(modules.some((url) => url.includes('/feed-preview-'))).toBe(false)
    await page.getByRole('button', { name: 'Feed', exact: true }).click()
    const feed = page.getByRole('region', { name: 'Feed preview', exact: true })
    const chooser = feed.getByRole('combobox', { name: 'Feed example', exact: true })
    await expect(chooser).toBeVisible()
    expect(modules.some((url) => url.includes('/feed-preview-') && url.endsWith('.js'))).toBe(true)
    for (const status of ['preparing', 'running', 'success', 'error']) {
      await expect(feed.locator(`.tool-call-${status}`).first()).toBeVisible()
    }
    const check = feed.getByRole('button', { name: /^Check the project/ })
    await check.click()
    const call = feed.locator('.tool-call').filter({ has: page.getByRole('button', { name: /^Check the project/ }) })
    await expect(call.getByRole('region', { name: 'Tool output', exact: true })).toContainText('No warnings or errors.')
    await call.getByRole('button', { name: 'View details', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Check the project', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: 'Input', exact: true }).click()
    await expect(dialog.getByRole('region', { name: 'Input JSON', exact: true })).toContainText('pnpm lint')
    await dialog.getByRole('tab', { name: 'Output', exact: true }).click()
    await expect(dialog.getByRole('region', { name: 'Output JSON', exact: true })).toContainText('No warnings or errors.')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await feed.getByRole('button', { name: /^Update the example greeting/ }).click()
    await expect(feed.locator('.tool-changes')).toBeVisible()
    await expect.poll(() => feed.locator('.tool-changes').evaluate((element) =>
      element.querySelector('diffs-container')?.shadowRoot?.querySelector('pre')?.textContent ?? ''
    )).toContain('Welcome home')
    await chooser.selectOption('plan')
    for (const status of ['pending', 'in_progress', 'completed', 'error']) {
      await expect(feed.locator(`.task-list-item-${status}`)).toHaveCount(1)
    }
    const marker = feed.locator('.task-list-item-in_progress .loader-xs .loader-indicator')
    await expect(marker).toHaveCSS('width', '12px')
    await expect.poll(() => marker.evaluate((element) => getComputedStyle(element, '::before').animationName))
      .toBe(reducedMotion === 'reduce' ? 'none' : 'loader-indicator-pulse')
    await finishFiniteAnimations(feed)
    await feed.screenshot({ path: testInfo.outputPath(`feed-plan-${theme}.png`) })
    const examples = createFeedPreviewExamples(Date.now())
    for (const example of examples) {
      await chooser.selectOption(example.id)
      await expect(feed.getByRole('heading', { name: example.title, exact: true })).toBeVisible()
      await expect(feed.locator('.leon-message')).toHaveCount(1)
      if (example.kind === 'turn') {
        await expect(feed.locator('.owner-message')).toContainText('Check the project')
      }
    }
    await chooser.selectOption('code')
    for (const language of ['TypeScript', 'Python']) {
      const logo = feed.locator('.markdown-code-header').getByRole('img', { name: language, exact: true })
      await expect(logo).toHaveCSS('width', '16px')
      await expect(logo).toHaveCSS('height', '16px')
    }
    await feed.screenshot({ path: testInfo.outputPath(`feed-code-${theme}.png`) })
    await chooser.selectOption('completed-no-plan')
    await feed.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
    await expect(feed.getByRole('region', { name: 'Leon’s review', exact: true })).toContainText('Reviewed for 1s')
    await expect(feed.getByRole('region', { name: 'Leon’s final answer', exact: true })).toContainText('The project checks are complete.')
    await expect(feed.getByRole('complementary', { name: 'FYI', exact: true })).toBeVisible()
    const actions = feed.getByRole('group', { name: 'Answer actions', exact: true })
    await actions.hover()
    await actions.getByRole('button', { name: 'Turn info', exact: true }).click()
    await expect(page.getByLabel('Recorded token metrics', { exact: true })).toContainText('2,400 in')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Narrow preview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    for (const id of ['tools', 'plan', 'completed-plan']) {
      await chooser.selectOption(id)
      if (id === 'completed-plan') {
        await feed.getByRole('button', { name: 'Worked for 12s', exact: true }).click()
        await feed.getByRole('button', { name: 'Completed plan for 7s', exact: true }).click()
      }
      await finishFiniteAnimations(feed)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await feed.screenshot({ path: testInfo.outputPath(`feed-${id}-${theme}-narrow.png`) })
    }
    await feed.getByRole('button', { name: 'Replay example', exact: true }).click()
    await expect(feed.getByRole('button', { name: 'Worked for 12s', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: 'Components', exact: true }).click()
    await expect(feed).toHaveCount(0)
    await expect.poll(() => page.workers().length).toBe(0)
    expect(errors).toEqual([])
    expect(unexpectedRequests).toEqual([])
  })
}

test('slides connection details as one reversible block and releases cancelled exits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
  await page.getByRole('combobox', { name: 'Connection', exact: true }).selectOption('productivity_collaboration.notion')
  const card = page.getByRole('region', { name: 'Notion', exact: true })
  const open = card.getByRole('button', { name: 'Display OAuth settings', exact: true })
  const back = card.getByRole('button', { name: 'Back', exact: true })
  const collapse = card.locator('.aurora-connection-collapse')
  const field = card.getByLabel('Client ID', { exact: true })
  const footer = card.locator('footer')
  const closedTop = (await footer.boundingBox())!.y

  await open.click()
  await expect(field).toBeVisible()
  await finishFiniteAnimations(card)
  const openTop = (await footer.boundingBox())!.y
  await field.fill('unsaved-preview-value')
  // Pause browser-owned motion at its midpoint to inspect layout without sleeps.
  await back.evaluate(async (button: HTMLButtonElement) => {
    const block = button.closest('section')!.querySelector('.aurora-connection-collapse')!
    button.click()
    await new Promise(requestAnimationFrame)
    for (const animation of block.getAnimations()) {
      animation.pause()
      animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2
    }
  })
  await expect(collapse).toHaveAttribute('inert', '')
  await expect(collapse).toHaveAttribute('aria-hidden', 'true')
  await expect(field).toHaveValue('')
  const middleTop = (await footer.boundingBox())!.y
  expect(middleTop).toBeGreaterThan(closedTop)
  expect(middleTop).toBeLessThan(openTop)
  await collapse.evaluate((element) => {
    for (const animation of element.getAnimations()) {
      animation.finish()
    }
  })
  await expect(collapse).toHaveCount(0)
  expect(Math.abs((await footer.boundingBox())!.y - closedTop)).toBeLessThan(1)

  await open.click()
  await finishFiniteAnimations(card)
  await back.evaluate(async (button: HTMLButtonElement) => {
    const block = button.closest('section')!.querySelector('.aurora-connection-collapse')!
    button.click()
    await new Promise(requestAnimationFrame)
    for (const animation of block.getAnimations()) {
      animation.pause()
    }
  })
  // A new screen must survive the previous screen's pending exit cleanup.
  await open.evaluate((button: HTMLButtonElement) => button.click())
  await finishFiniteAnimations(card)
  await expect(field).toBeVisible()
  await expect(collapse).toHaveAttribute('aria-hidden', 'false')
  await back.evaluate(async (button: HTMLButtonElement) => {
    const block = button.closest('section')!.querySelector('.aurora-connection-collapse')!
    button.click()
    await new Promise(requestAnimationFrame)
    for (const animation of block.getAnimations()) {
      animation.cancel()
    }
  })
  await expect(collapse).toHaveCount(0)
})

for (const motion of ['reduced', 'zero duration'] as const) {
  test(`releases connection fields when closing with ${motion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' })
    await page.goto('/aurora.html')
    if (motion === 'zero duration') {
      await page.addStyleTag({ content: '.aurora-connection-collapse { transition-duration: 0s; }' })
    }
    await page.getByRole('button', { name: 'Connections', exact: true }).click()
    await page.getByRole('combobox', { name: 'Connection', exact: true }).selectOption('productivity_collaboration.notion')
    const card = page.getByRole('region', { name: 'Notion', exact: true })
    await card.getByRole('button', { name: 'Display OAuth settings', exact: true }).click()
    await card.getByLabel('Client ID', { exact: true }).fill('unsaved-preview-value')
    await card.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(card.locator('.aurora-connection-body')).toHaveCount(0)
    await card.getByRole('button', { name: 'Display OAuth settings', exact: true }).click()
    await expect(card.getByLabel('Client ID', { exact: true })).toHaveValue('')
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`previews declared connections and their setup states without external requests (${theme})`, async ({ page }, testInfo) => {
    const external: string[] = []
    const origin = new URL(testInfo.project.use.baseURL!).origin
    page.on('request', (request) => {
      if (!request.url().startsWith('data:') && new URL(request.url()).origin !== origin) {
        external.push(request.url())
      }
    })
    await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Connections', exact: true }).click()
    const chooser = page.getByRole('combobox', { name: 'Connection', exact: true })
    await expect(chooser.getByRole('option')).toHaveCount(CONNECTIONS.length)
    for (const connection of CONNECTIONS) {
      const name = connection.name
      await chooser.selectOption(connection.provider)
      const card = page.getByRole('region', { name, exact: true })
      if (connection.logo) {
        const logo = card.locator('.aurora-connection-icon img.package-icon')
        await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
      }
      await expect(card.locator('.aurora-connection-icon')).toHaveCSS('width', '48px')
      await expect(card.locator('.aurora-connection-icon')).toHaveCSS('height', '48px')
      await expect(card.locator('.aurora-connection-identity h3')).toHaveCSS('font-size', '18px')
      await expect(card.locator('.aurora-connection-identity h3')).toHaveCSS('font-weight', '600')
      await expect(card.locator('.aurora-connection-identity p')).toHaveCSS('font-size', '16px')
      await expect(card.getByRole('button', { name: 'Refresh status', exact: true })).toHaveCount(0)
      const state = page.getByRole('combobox', { name: 'Preview state' })
      for (const [value, label] of [['adding', 'Adding…'], ['enabling', 'Enabling…'], ['loading', 'Loading…']] as const) {
        await state.selectOption(value)
        const pending = card.getByRole('button', { name: label, exact: true })
        await expect(pending).toBeDisabled()
        await expect(pending.locator('.loader-indicator')).toBeVisible()
      }
      await state.selectOption('installation')
      const add = card.getByRole('button', { name: `Add ${name}`, exact: true })
      await expect(add).toHaveText('Add')
      await add.click()
      await expect(card.getByRole('button', { name: `Connect ${name}`, exact: true })).toHaveText('Connect')
      await expect(card.locator('input')).toHaveCount(0)
      await expect(card.locator('header').getByRole('button')).toHaveCount(0)
      const footer = card.locator('footer')
      await expect(footer.getByRole('button', { name: `Connect ${name}`, exact: true })).toBeVisible()
      await expect(footer).toHaveCSS('padding', '12px 16px')
      await expect(footer).toHaveCSS('gap', '8px')
      expect(await footer.evaluate((element) => {
        const styles = getComputedStyle(document.documentElement)
        const probe = document.createElement('span')
        probe.style.color = styles.getPropertyValue('--color-surface')
        document.body.append(probe)
        const surface = getComputedStyle(probe).color
        probe.remove()

        return getComputedStyle(element).backgroundColor === surface
      })).toBe(true)
      if (connection.serverURL) {
        await expect(card.locator('.aurora-connection-body')).toHaveCount(0)
        await footer.getByRole('button', { name: 'Display OAuth settings', exact: true }).click()
        await expect(card.getByLabel('Client ID', { exact: true })).toBeVisible()
        await card.getByLabel('Client ID', { exact: true }).fill('unsaved-preview-client')
        await footer.getByRole('button', { name: 'Back', exact: true }).click()
        await expect(card.locator('input')).toHaveCount(0)
        await expect(card.locator('.aurora-connection-body')).toHaveCount(0)
        await card.screenshot({ path: testInfo.outputPath(`${connection.provider}-initial-${theme}.png`) })
      }
      await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
      const method = connection.methods['oauth'] ?? connection.methods['api_key']!
      const needsApplication = Object.keys(method.settings).length > 0
      if (needsApplication) {
        const instructions = card.getByRole('list')
        await expect(instructions).toHaveCSS('list-style-type', 'decimal')
        await expect(instructions).toHaveCSS('list-style-position', 'inside')
        await expect(instructions).toHaveCSS('padding-left', '0px')
        await expect(instructions).toHaveCSS('font-size', '16px')
        await expect(instructions.getByRole('link').first()).toHaveAttribute('href', method.setup_url)
        await expect(card.locator('details')).toHaveCount(0)
        await expect(card.getByRole('button', { name: 'Back to setup instructions' })).toHaveCount(0)
        const connect = card.getByRole('button', { name: `Connect ${name}`, exact: true })
        await expect(connect).toBeDisabled()
        await expect(card.locator('header').getByRole('button')).toHaveCount(0)
        await expect(footer.getByRole('button', { name: `Connect ${name}`, exact: true })).toBeVisible()
        await footer.getByRole('button', { name: 'Back', exact: true }).click()
        await expect(card.locator('input')).toHaveCount(0)
        await connect.click()
        await expect(connect).toBeDisabled()
        const fields = card.locator('input')
        for (const field of await fields.all()) {
          await field.fill(' ')
        }
        await expect(connect).toBeDisabled()
        for (const field of await card.locator('input').all()) {
          await field.fill('preview-only-value')
        }
        if (name === 'TickTick' || name === 'Gmail') {
          await expect(card.getByLabel('Client secret', { exact: true })).toHaveAttribute('type', 'password')
        }
        const help = card.getByRole('button', { name: 'Set it up for me', exact: true })
        if (await help.count()) {
          const divider = card.getByRole('separator', { name: 'or', exact: true })
          await expect(divider).toBeVisible()
          await expect.poll(() => help.evaluate((button) => {
            const divider = button.parentElement!.querySelector('[role="separator"]')!

            return button.getBoundingClientRect().y - divider.getBoundingClientRect().bottom
          })).toBeGreaterThan(0)
          await page.setViewportSize({ width: 390, height: 844 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await expect.poll(() => help.evaluate((button) => {
            const instructions = button.closest('.aurora-connection-body')!.querySelector('ol')!

            return button.getBoundingClientRect().y - instructions.getBoundingClientRect().bottom
          })).toBeGreaterThan(0)
          await page.setViewportSize({ width: 1_512, height: 982 })
        }
        await card.screenshot({ path: testInfo.outputPath(`${connection.provider}-${theme}.png`) })
        await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
      }
      if (connection.methods['oauth']) {
        const connecting = card.getByRole('button', { name: 'Connecting…', exact: true })
        await expect(connecting).toBeDisabled()
        await expect(connecting).toHaveAttribute('aria-busy', 'true')
        expect(await connecting.evaluate((button) => getComputedStyle(button).color ===
          getComputedStyle(button.querySelector('.loader-indicator')!).color)).toBe(true)
        await page.getByRole('button', { name: 'Finish authorization', exact: true }).click()
      }
      await expect(card.locator('header .badge-success')).toHaveText('Connected')
      await expect(card.locator('header .badge-success .badge-dot')).toBeVisible()
      await expect(card.getByRole('button', { name: 'Connected', exact: true })).toHaveCount(0)
      await card.screenshot({ path: testInfo.outputPath(`${connection.provider}-connected-${theme}.png`) })
      const continuation = card.getByRole('button', { name: 'Continue', exact: true })
      await expect(continuation).toHaveClass(/button-primary/)
      expect(await continuation.evaluate((button) => {
        const bounds = button.getBoundingClientRect()
        const parent = button.parentElement!.getBoundingClientRect()

        return Math.abs(bounds.right - parent.right + parseFloat(getComputedStyle(button.parentElement!).paddingRight))
      })).toBeLessThan(1)
      await continuation.click()
      await expect(continuation).toHaveCount(0)
      await state.selectOption('failed')
      await expect(card.getByRole('alert')).toContainText('I couldn’t complete this step')
      await expect(card.locator('header .badge-error .badge-dot')).toBeVisible()
      if (connection.methods['oauth']) {
        await state.selectOption('cancelled')
        await expect(card.getByRole('status')).toContainText('Authorization was cancelled')
        await expect(card.locator('header .badge-warning .badge-dot')).toBeVisible()
      }
      if (connection.methods['api_key'] && connection.methods['oauth']) {
        await page.getByRole('combobox', { name: 'Preview configuration' }).selectOption('fallback')
        await card.getByRole('button', { name: `Connect ${name}`, exact: true }).click()
        const token = card.getByLabel('Access token', { exact: true })
        await token.fill('preview-only-token')
        await token.press('Enter')
        await expect(card.locator('header .badge-success')).toHaveText('Connected')
      }
    }
    await chooser.selectOption('music_audio.spotify')
    const spotify = page.getByRole('region', { name: 'Spotify', exact: true })
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await expect(spotify.getByText('Redirect URI', { exact: true })).toBeVisible()
    await expect(spotify.locator('input[type="password"]')).toHaveCount(0)
    await spotify.getByLabel('Client ID', { exact: true }).fill('sample-client')
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await expect(spotify.getByRole('button', { name: 'Connecting…', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Finish authorization', exact: true }).click()
    await expect(spotify.locator('header .badge-success')).toHaveText('Connected')
    await page.getByRole('combobox', { name: 'Preview configuration' }).selectOption('ready')
    await expect(spotify.locator('input')).toHaveCount(0)
    await expect(spotify.getByRole('button', { name: 'Set up manually', exact: true })).toHaveCount(0)
    await spotify.getByRole('button', { name: 'Connect Spotify', exact: true }).click()
    await expect(spotify.getByRole('button', { name: 'Connecting…', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel authorization', exact: true }).click()
    await expect(spotify.getByRole('status')).toContainText('Authorization was cancelled')
    await page.getByRole('combobox', { name: 'Preview state' }).selectOption('failed')
    await expect(spotify.getByRole('alert')).toContainText('I couldn’t complete this step')
    await page.getByRole('combobox', { name: 'Preview configuration' }).selectOption('application')
    await page.getByRole('combobox', { name: 'Preview state' }).selectOption('assisted')
    await expect(spotify.getByLabel('Client ID', { exact: true })).toBeVisible()
    await expect(spotify.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeDisabled()
    await expect(spotify.getByText('You can follow setup progress in the conversation.', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`connections-${theme}.png`), fullPage: true })
    await spotify.screenshot({ path: testInfo.outputPath(`spotify-${theme}.png`) })
    expect(external).toEqual([])
    expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain('preview-only-token')
  })
}

test('previews actual generated charts, calculations and SVG explanations with local-only submissions', async ({ page }, testInfo) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Generated UI', exact: true }).click()
  const dashboard = page.frameLocator('iframe[title="A little room for reading"]')
  await expect(dashboard.locator('canvas')).toBeVisible()
  await dashboard.getByRole('slider', { name: 'Daily reading goal' }).fill('40')
  await expect(dashboard.locator('#week-total')).toContainText('280 minutes')
  await dashboard.getByRole('button', { name: 'Plan around this goal' }).click()
  await page.getByRole('button', { name: 'Send selection', exact: true }).click()
  await expect(page.getByLabel('Submitted values')).toContainText('40')
  const calculator = page.frameLocator('iframe[title="A small saving habit"]')
  await calculator.getByRole('slider', { name: 'Monthly saving' }).fill('1000')
  await expect(calculator.locator('#yearly')).toHaveText('¥12000')
  await page.screenshot({ path: testInfo.outputPath('generated-ui-light.png'), fullPage: true })
  const light = page.frameLocator('iframe[title="A little light, a little distance"]')
  await light.getByRole('slider', { name: 'Distance in metres' }).fill('2')
  await expect(light.locator('#brightness')).toContainText('25.0%')
  await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
  await expect(calculator.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(calculator.locator('#yearly')).toHaveText('¥12000')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const theme of ['dark', 'light'] as const) {
  test(`keeps a connected memory overview readable while exploring sources (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await page.getByRole('searchbox', { name: 'Find a component or widget' }).fill('memory map')
    await page.getByRole('button', { name: 'Generated UI', exact: true }).click()
    const frame = page.frameLocator('iframe[title="A little map of memory"]')
    const element = page.locator('iframe[title="A little map of memory"]')
    await expect(frame.getByRole('button', { name: 'Memory stores', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await frame.getByRole('button', { name: 'Archives', exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'The original conversation', exact: true })).toBeVisible()
    await expect(frame.locator('.memory-context')).toBeVisible()
    await expect(frame.locator('.memory-connections')).toBeVisible()
    await element.screenshot({ path: testInfo.outputPath(`memory-map-${theme}.png`) })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(frame.getByRole('button', { name: 'Archives', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await element.screenshot({ path: testInfo.outputPath(`memory-map-${theme}-narrow.png`) })
  })
}

for (const [theme, reducedMotion] of [['light', 'reduce'], ['dark', 'no-preference']] as const) {
  test(`previews shared components in wide and narrow layouts (${theme}, ${reducedMotion})`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.emulateMedia({ reducedMotion })
    await page.goto('/aurora.html')
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Apply light theme', exact: true }).click()
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('heading', { name: 'Buttons', exact: true })).toBeVisible()
    const buttons = page.getByRole('region', { name: 'Buttons', exact: true })
    const enabledBorder = await buttons.getByRole('button', { name: 'Save for later', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundImage)
    await expect(buttons.getByRole('button', { name: 'Unavailable', exact: true })).not.toHaveCSS('background-image', enabledBorder)
    const saving = buttons.getByRole('button', { name: 'Saving…', exact: true })
    const primaryColor = await buttons.getByRole('button', { name: 'Continue', exact: true })
      .evaluate((button) => getComputedStyle(button).color)
    await expect(saving).toBeDisabled()
    await expect(saving).toHaveCSS('background-image', /none$/)
    await expect(saving).toHaveCSS('background-clip', 'border-box, border-box, border-box')
    await expect(saving).toHaveCSS('cursor', 'wait')
    await expect(saving).toHaveCSS('color', primaryColor)
    await expect(saving.locator('.loader-indicator')).toHaveCSS('color', primaryColor)
    const badges = page.getByRole('region', { name: 'Badges', exact: true })
    for (const variant of ['primary', 'secondary', 'success', 'error', 'warning']) {
      const badge = badges.locator(`.badge-${variant}`)
      await expect(badge).toBeVisible()
      await expect(badge.locator('.badge-dot')).toHaveCount(variant === 'secondary' ? 0 : 1)
      if (variant !== 'secondary') {
        expect(await badge.evaluate((element) => getComputedStyle(element).color ===
          getComputedStyle(element.querySelector('.badge-dot')!).backgroundColor)).toBe(true)
      }
    }
    for (const label of ['New', 'Soon']) {
      await expect(badges.getByText(label, { exact: true })).toHaveCSS('width', '56px')
    }
    await page.getByRole('button', { name: 'Pin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const selection = page.getByRole('region', { name: 'Selections', exact: true })
    const checkbox = selection.getByRole('checkbox', { name: 'Leave a little room for a new idea', exact: true })
    await checkbox.check()
    await expect(checkbox.locator('..').locator('.aurora-selection-check')).toHaveCSS('opacity', '1')
    expect(await checkbox.evaluate((input) => {
      const mark = input.parentElement!.querySelector<SVGElement>('.aurora-selection-check')!
      const box = input.getBoundingClientRect()
      const svg = mark.closest('svg')!.getBoundingClientRect()
      const styles = getComputedStyle(document.documentElement)
      const probe = document.createElement('span')
      probe.style.color = styles.getPropertyValue('--color-accent-contrast')
      document.body.append(probe)
      const contrast = getComputedStyle(probe).color
      probe.remove()

      return { centered: Math.abs(box.x + box.width / 2 - svg.x - svg.width / 2) < 1 &&
        Math.abs(box.y + box.height / 2 - svg.y - svg.height / 2) < 1,
      contrasted: getComputedStyle(mark).fill === contrast, visible: getComputedStyle(mark).opacity === '1' }
    })).toEqual({ centered: true, contrasted: true, visible: true })
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await expect(checkbox.locator('..').locator('.aurora-selection-check')).toHaveCSS('opacity', '0')
    const search = page.getByRole('searchbox', { name: 'Find a component or widget' })
    await search.fill('loaders')
    await expect(page.getByRole('heading', { name: 'Loaders', exact: true })).toBeVisible()
    const loaders = page.getByRole('region', { name: 'Loaders', exact: true })
    for (const [size, pixels] of [['xs', 12], ['sm', 16], ['md', 20]] as const) {
      const indicator = loaders.locator(`.loader-${size} .loader-indicator`)
      await expect(indicator).toHaveCSS('width', `${pixels}px`)
      await expect(indicator).toHaveCSS('height', `${pixels}px`)
    }
    await expect(page.getByRole('heading', { name: 'Buttons', exact: true })).toHaveCount(0)
    await search.fill('')
    await page.getByRole('button', { name: 'Narrow preview', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`aurora-${theme}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Widgets', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible()
    for (const title of ['Multiple choice', 'Form', 'Tool preparation', 'Data table']) {
      const widget = page.getByRole('region', { name: title, exact: true })
      const surfaces = widget.locator('.aurora-surface')
      await expect(surfaces).toHaveCount(title === 'Tool preparation' ? 2 : 1)
      for (const [index, surface] of (await surfaces.all()).entries()) {
        const footer = surface.locator('.aurora-surface-footer')
        await expect(footer).toBeVisible()
        await expect(footer).toHaveCSS('padding', '12px 16px')
        await expect(footer).toHaveCSS('gap', '8px')
        await expect(footer).toHaveCSS('justify-content', 'flex-end')
        await expect(footer.getByRole('button').first()).toBeVisible()
        await surface.screenshot({ path: testInfo.outputPath(`${title.toLowerCase().replaceAll(' ', '-')}-${index}-${theme}.png`) })
      }
    }
    const emptyCheckbox = page.getByRole('region', { name: 'Multiple choice', exact: true }).getByRole('checkbox').first()
    const emptyBackground = await emptyCheckbox.evaluate((input) => getComputedStyle(input).backgroundColor)
    const boolean = page.getByRole('region', { name: 'Boolean choice', exact: true })
    for (const radio of await boolean.getByRole('radio').all()) {
      await expect(radio).not.toBeChecked()
      await expect(radio).toHaveCSS('background-color', emptyBackground)
      expect(await radio.evaluate((input) => {
        const mark = input.parentElement!.querySelector('.aurora-selection-check')!

        return getComputedStyle(mark).opacity
      })).toBe('0')
    }
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`aurora-widgets-${theme}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('submits explicit boolean, keyboard single and multiple selections locally', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const boolean = page.getByRole('region', { name: 'Boolean choice', exact: true })
  await expect(boolean.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await boolean.getByRole('radio', { name: 'Yes', exact: true }).check()
  await expect(boolean.getByLabel('Submitted values')).toHaveText('true')
  await expect(boolean.getByRole('radio', { name: 'Yes', exact: true })).toBeDisabled()
  const single = page.getByRole('region', { name: 'Single choice', exact: true })
  const first = single.getByRole('radio').first()
  await first.focus()
  await first.press('ArrowDown')
  await expect(single.getByRole('radio').nth(1)).toBeChecked()
  await expect(single.getByLabel('Submitted values')).toHaveCount(0)
  await expect(single.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await single.getByRole('radio').nth(1).press('Space')
  await expect(single.getByLabel('Submitted values')).toContainText('creative')
  await single.getByRole('button', { name: 'Reset example' }).click()
  await single.getByRole('radio').first().focus()
  await single.getByRole('radio').first().press('Enter')
  await expect(single.getByLabel('Submitted values')).toContainText('quiet')
  const multiple = page.getByRole('region', { name: 'Multiple choice', exact: true })
  await multiple.getByRole('checkbox').first().check()
  await multiple.getByRole('checkbox').last().check()
  await expect(multiple.getByLabel('Submitted values')).toHaveCount(0)
  await multiple.getByRole('button', { name: 'Continue' }).click()
  await expect(multiple.getByLabel('Submitted values')).toHaveText('[\n  "quiet",\n  "outside"\n]')
  expect(requests).toEqual([])
})

test('navigates composite controls with native constraints and keyboard selection', async ({ page }) => {
  await page.goto('/aurora.html')
  const toggle = page.getByRole('switch', { name: 'A little background music' })
  await expect(toggle).toBeChecked()
  await toggle.focus()
  await toggle.press('Space')
  await expect(toggle).not.toBeChecked()
  const segmented = page.getByRole('radio', { name: 'Gentle', exact: true })
  await segmented.focus()
  await segmented.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Focused', exact: true })).toBeChecked()
  await page.getByRole('tab', { name: 'Ideas', exact: true }).focus()
  await page.getByRole('tab', { name: 'Ideas', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Notes', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('Keep the useful pieces together.')
  const number = page.getByRole('spinbutton', { name: 'Reading minutes' })
  await page.getByRole('button', { name: 'Increase Reading minutes' }).click()
  await expect(number).toHaveValue('35')
  await number.fill('60')
  await expect(page.getByRole('button', { name: 'Increase Reading minutes' })).toBeDisabled()
  await page.getByRole('button', { name: 'Decrease Reading minutes' }).click()
  await expect(number).toHaveValue('55')
  const search = page.getByRole('combobox', { name: 'Choose a moment', exact: true })
  await search.fill('creative')
  await expect(page.getByRole('option', { name: 'Something creative', exact: true })).toBeVisible()
  await search.press('ArrowDown')
  await expect(search).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'Something creative', exact: true }).getAttribute('id') ?? ''
  )
  await search.press('Enter')
  await expect(search).toHaveValue('Something creative')
  const multiple = page.getByRole('combobox', { name: 'Make room for', exact: true })
  await multiple.click()
  await multiple.fill('quiet')
  await expect(page.getByRole('option', { name: 'A quiet morning', exact: true })).toBeVisible()
  await multiple.press('ArrowDown')
  await expect(multiple).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'A quiet morning', exact: true }).getAttribute('id') ?? ''
  )
  await multiple.press('Enter')
  await expect(page.getByLabel('Selected moments')).toHaveText('quiet')
  await multiple.fill('outside')
  await expect(page.getByRole('option', { name: 'Time outside', exact: true })).toBeVisible()
  await multiple.press('ArrowDown')
  await expect(multiple).toHaveAttribute(
    'aria-activedescendant',
    await page.getByRole('option', { name: 'Time outside', exact: true }).getAttribute('id') ?? ''
  )
  await multiple.press('Enter')
  await expect(page.getByLabel('Selected moments')).toHaveText('quiet, outside')
  const summary = page.getByRole('list', { name: 'Make room for selection', exact: true })
  await expect(summary.getByRole('button', { name: 'Remove A quiet morning' })).toBeVisible()
  await summary.getByRole('button', { name: 'Remove A quiet morning' }).click()
  await expect(page.getByLabel('Selected moments')).toHaveText('outside')
})

test('filters, sorts and pages native data, compares differences and exposes chart data', async ({ page }, testInfo) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const table = page.getByRole('region', { name: 'Reading notes', exact: true })
  await expect(table.getByRole('row')).toHaveCount(13)
  await table.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(table.getByRole('row')).toHaveCount(5)
  await table.getByRole('button', { name: 'Sort by Minutes', exact: true }).click()
  await table.getByRole('button', { name: 'Sort by Minutes', exact: true }).click()
  await expect(table.getByRole('row').nth(1)).toContainText('80')
  await table.getByRole('searchbox').fill('Day 16')
  await expect(table.getByRole('row')).toHaveCount(2)
  const comparison = page.getByRole('region', { name: 'Comparison', exact: true })
  await expect(comparison.getByRole('cell', { name: 'Kitchen', exact: true })).toBeVisible()
  await comparison.getByRole('switch', { name: 'Only differences' }).check()
  await expect(comparison.getByRole('cell', { name: 'Kitchen', exact: true })).toHaveCount(0)
  await expect(comparison.getByRole('cell', { name: 'Garden', exact: true })).toBeVisible()
  const chart = page.getByRole('region', { name: 'A little time to read', exact: true })
  await expect(chart.locator('canvas')).toBeVisible()
  await chart.getByText('View data', { exact: true }).click()
  await expect(chart.getByRole('columnheader', { name: 'Reading (min)' })).toBeVisible()
  await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  const example = page.getByRole('region', { name: 'Chart', exact: true })
  for (const kind of ['Line', 'Pie', 'Bar']) {
    await example.getByRole('radio', { name: kind, exact: true }).check()
    await expect(chart.locator('canvas')).toBeVisible()
    await expect(chart.getByRole('cell', { name: '45', exact: true })).toBeVisible()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('native-widgets.png'), fullPage: true })
  expect(requests).toEqual([])
})

test('copies natural owner queries without sending a request or changing an example', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string): Promise<void> => {
        document.documentElement.dataset['copiedQuery'] = text
      }
    } })
  })
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      requests.push(request.url())
    }
  })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const titles = {
    boolean: 'Boolean choice', 'single-choice': 'Single choice',
    'multi-choice': 'Multiple choice', form: 'Form'
  }
  for (const id of Object.keys(titles) as (keyof typeof titles)[]) {
    const example = page.getByRole('region', { name: titles[id], exact: true })
    const query = example.getByRole('complementary', { name: 'Try in Leon', exact: true })
    await expect(query.getByText(AURORA_QUERY_EXAMPLES[id], { exact: true })).toBeVisible()
    await query.getByRole('button', { name: 'Copy query', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-copied-query', AURORA_QUERY_EXAMPLES[id])
    await expect(query.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    await expect(example.getByLabel('Submitted values')).toHaveCount(0)
  }
  expect(requests).toEqual([])
})

test('validates fields, preserves failed drafts and locks pending or accepted submissions', async ({ page }) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const form = page.getByRole('region', { name: 'Form', exact: true })
  const save = form.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toBeFocused()
  await expect(form.getByLabel('Submitted values')).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Project name' }).fill('A small garden')
  await form.getByRole('combobox', { name: 'Pace', exact: true }).selectOption('gentle')
  await form.getByRole('textbox', { name: 'Anything else?' }).fill('Leave time to explore.')
  await form.getByRole('combobox', { name: 'Preview result' }).selectOption('failure')
    await form.getByRole('textbox', { name: 'Project name' }).press('Enter')
  await expect(form.getByRole('alert')).toContainText('I couldn\'t save this')
  await expect(form.getByRole('textbox', { name: 'Project name' })).toHaveValue('A small garden')
  await form.getByRole('combobox', { name: 'Preview result' }).selectOption('pending')
  await save.click()
  await expect(save).toHaveAttribute('aria-busy', 'true')
  await expect(save).toBeDisabled()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toBeDisabled()
  await form.getByRole('button', { name: 'Finish save' }).click()
  await expect(form.getByRole('status', { name: '', exact: true })).toHaveText('Saved. Thank you.')
  await expect(form.getByLabel('Submitted values')).toContainText('Leave time to explore.')
  await expect(save).toBeDisabled()
  await form.getByRole('button', { name: 'Reset example' }).click()
  await expect(form.getByRole('textbox', { name: 'Project name' })).toHaveValue('')
})

test('shows measured and indeterminate preparation with cancellation and retry', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Widgets', exact: true }).click()
  const example = page.getByRole('region', { name: 'Tool preparation', exact: true })
  const preparation = example.getByRole('region', { name: 'Getting things ready', exact: true })
  const downloads = example.getByRole('region', { name: 'File downloads', exact: true })
  await expect(downloads.getByRole('listitem')).toHaveCount(3)
  await expect(downloads).toContainText('36 MB / 100 MB · ETA 12s')
  await expect(downloads.getByText('36%', { exact: true })).toHaveCount(1)
  await expect(preparation.getByRole('progressbar')).toHaveAttribute('value', '36')
  const fill = preparation.locator('.aurora-progress-fill')
  await fill.evaluate((element) => {
    const start = element.getBoundingClientRect().width
    const observer = new MutationObserver(() => {
      observer.disconnect()
      const animation = element.getAnimations().find((motion) => motion instanceof CSSTransition && motion.transitionProperty === 'width')
      if (!animation) {
        return
      }
      animation.pause()
      animation.currentTime = Number(animation.effect!.getComputedTiming().duration) / 2
      const middle = element.getBoundingClientRect().width
      animation.finish()
      Reflect.set(element, 'observedProgressMotion', { start, middle, end: element.getBoundingClientRect().width })
    })
    observer.observe(element, { attributes: true, attributeFilter: ['style'] })
  })
  await example.getByRole('slider', { name: 'Measured progress' }).fill('72')
  await expect(preparation.getByRole('progressbar')).toHaveAttribute('value', '72')
  const motion = await fill.evaluate((element) => Reflect.get(element, 'observedProgressMotion')) as {
    start: number
    middle: number
    end: number
  }
  expect(motion.middle).toBeGreaterThan(motion.start)
  expect(motion.middle).toBeLessThan(motion.end)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(fill).toHaveCSS('transition-duration', '0s')
  await example.getByRole('slider', { name: 'Measured progress' }).fill('80')
  await expect(preparation.getByRole('progressbar')).toHaveAttribute('value', '80')
  expect(await fill.evaluate((element) => element.getAnimations().length)).toBe(0)
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(preparation.getByRole('progressbar')).toHaveCSS('opacity', '1')
  await expect(fill).toBeHidden()
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
  await example.getByRole('slider', { name: 'Measured progress' }).fill('72')
  await preparation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preparation.getByRole('status')).toHaveText('Download cancelled.')
  const state = example.getByRole('combobox', { name: 'Preview state' })
  await state.selectOption('failed')
  await expect(preparation.getByRole('alert')).toContainText('try again')
  await preparation.getByRole('button', { name: 'Try again' }).click()
  await expect(preparation.getByRole('progressbar')).toBeVisible()
  await state.selectOption('preparing')
  await expect(preparation.getByRole('progressbar')).toHaveCount(0)
  await expect(preparation.getByRole('status')).toContainText('Checking the files')
  await state.selectOption('downloading')
  await example.getByRole('checkbox', { name: 'Known file size' }).uncheck()
  await expect(downloads.getByRole('progressbar')).toHaveCount(0)
  await expect(downloads).toContainText('72 MB')
  await expect(downloads).not.toContainText('ETA')
  await example.getByRole('checkbox', { name: 'Known file size' }).check()
  const eta = example.getByRole('combobox', { name: 'Remaining time' })
  for (const [label, text] of [
    ['Minutes', '59m 42s'], ['Hours', '1h 59m 42s'], ['Minute boundary', '1m']
  ] as const) {
    await eta.selectOption({ label })
    await expect(downloads).toContainText(`ETA ${text}`)
  }
  await eta.selectOption({ label: 'Minutes' })
  const viewport = downloads.getByRole('region', { name: 'Download progress', exact: true })
  const topMask = downloads.locator('.scroll-container-mask-top')
  const bottomMask = downloads.locator('.scroll-container-mask-bottom')
  const moreFiles = example.getByRole('checkbox', { name: 'More download files' })

  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' })
    await page.getByRole('button', { name: `Apply ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', '')
    for (const width of [1_512, 390]) {
      await page.setViewportSize({ width, height: 982 })
      await expect.poll(() => downloads.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(topMask).toHaveCSS('opacity', '0')
      await expect(bottomMask).toHaveCSS('opacity', '0')
      await downloads.screenshot({ path: testInfo.outputPath(`downloads-${theme}-${width}.png`) })
      await moreFiles.check()
      await expect(topMask).toHaveCSS('opacity', '0')
      await expect(bottomMask).toHaveCSS('opacity', '1')
      await downloads.screenshot({ path: testInfo.outputPath(`downloads-top-${theme}-${width}.png`) })
      await viewport.evaluate((element) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
      })
      await expect(topMask).toHaveCSS('opacity', '1')
      await expect(bottomMask).toHaveCSS('opacity', '1')
      await downloads.screenshot({ path: testInfo.outputPath(`downloads-middle-${theme}-${width}.png`) })
      await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(topMask).toHaveCSS('opacity', '1')
      await expect(bottomMask).toHaveCSS('opacity', '0')
      await viewport.press('Home')
      await expect(topMask).toHaveCSS('opacity', '0')
      await moreFiles.uncheck()
      await expect(topMask).toHaveCSS('opacity', '0')
      await expect(bottomMask).toHaveCSS('opacity', '0')
    }
  }
})

test('embeds artifacts in answer order with image enlargement and a local document download', async ({ page }) => {
  await page.goto('/aurora.html')
  await page.getByRole('button', { name: 'Answer preview', exact: true }).click()
  const answer = page.getByRole('region', { name: 'Visual answer preview' })
  const intro = (await answer.getByText('A slow Sunday sounds lovely.', { exact: false }).boundingBox())!
  const image = answer.getByRole('img', { name: 'Sunday pancakes.jpeg', exact: true })
  expect((await image.boundingBox())!.y).toBeGreaterThan(intro.y)
  await answer.getByRole('button', { name: 'Enlarge Sunday pancakes.jpeg' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sunday pancakes.jpeg' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  const download = page.waitForEvent('download')
  await answer.locator('figure').filter({ hasText: 'Attention is all you need.pdf' }).getByRole('link', { name: 'Download', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Attention is all you need.pdf')
})
